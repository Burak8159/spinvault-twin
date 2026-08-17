$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$HostAddress = "127.0.0.1"
$ApiPort = if ($env:SPINVAULT_API_PORT) { [int]$env:SPINVAULT_API_PORT } else { 8001 }
$WebPort = if ($env:SPINVAULT_WEB_PORT) { [int]$env:SPINVAULT_WEB_PORT } else { 4191 }
$Venv = Join-Path $RepoRoot "backend\.venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
$ApiProcess = $null
$WebProcess = $null

function Stop-LocalStack {
    Write-Host ""
    Write-Host "Shutting down local stack..."
    foreach ($Process in @($ApiProcess, $WebProcess)) {
        if ($null -ne $Process -and -not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-PortAvailable([int]$Port) {
    $Listener = $null
    try {
        $Listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Parse($HostAddress),
            $Port
        )
        $Listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $Listener) {
            $Listener.Stop()
        }
    }
}

function Find-SystemPython {
    $Py = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($null -ne $Py) {
        return @($Py.Source, "-3")
    }

    $Python = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($null -ne $Python) {
        return @($Python.Source)
    }

    throw @"
Python 3.9 or newer was not found.

Install Python from https://www.python.org/downloads/windows/
During installation, select "Add python.exe to PATH", then double-click
RUN_ON_WINDOWS.bat again.
"@
}

function Invoke-SystemPython([string[]]$Arguments) {
    $PythonCommand = Find-SystemPython
    $Executable = $PythonCommand[0]
    $Prefix = @()
    if ($PythonCommand.Count -gt 1) {
        $Prefix = $PythonCommand[1..($PythonCommand.Count - 1)]
    }
    & $Executable @Prefix @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed with exit code $LASTEXITCODE."
    }
}

function Wait-ForApi {
    Write-Host -NoNewline "Waiting for the API to report healthy"
    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        if ($null -ne $ApiProcess -and $ApiProcess.HasExited) {
            throw "The API process exited during startup. Read its output above."
        }
        try {
            Invoke-WebRequest `
                -UseBasicParsing `
                -Uri "http://${HostAddress}:${ApiPort}/health" `
                -TimeoutSec 2 | Out-Null
            Write-Host " OK"
            return
        }
        catch {
            Write-Host -NoNewline "."
            Start-Sleep -Milliseconds 500
        }
    }
    throw "The API did not become healthy on http://${HostAddress}:${ApiPort}."
}

try {
    if (-not (Test-PortAvailable $ApiPort)) {
        throw "API port $ApiPort is already in use. Close the other program and try again."
    }
    if (-not (Test-PortAvailable $WebPort)) {
        throw "Website port $WebPort is already in use. Close the other program and try again."
    }

    if (-not (Test-Path $VenvPython)) {
        Write-Host "First run: creating the local Python environment..."
        Invoke-SystemPython -Arguments @("-m", "venv", $Venv)
    }

    & $VenvPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)"
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.9 or newer is required. Install a current Python release, delete backend\.venv, and try again."
    }

    & $VenvPython -c "import fastapi, pydantic_settings, uvicorn" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "First run: installing dependencies (internet is needed once)..."
        & $VenvPython -m pip install --disable-pip-version-check `
            -r (Join-Path $RepoRoot "backend\requirements.txt")
        if ($LASTEXITCODE -ne 0) {
            throw "Dependency installation failed. Check the pip error above."
        }
    }

    Write-Host "Starting the local API..."
    $env:SPINVAULT_WORKER_ENABLED = "true"
    $ApiProcess = Start-Process `
        -FilePath $VenvPython `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", $HostAddress, "--port", "$ApiPort") `
        -WorkingDirectory (Join-Path $RepoRoot "backend") `
        -NoNewWindow `
        -PassThru
    Remove-Item Env:\SPINVAULT_WORKER_ENABLED -ErrorAction SilentlyContinue

    Write-Host "Starting the local website..."
    $WebsiteScript = '"' + (Join-Path $RepoRoot "scripts\serve_website.py") + '"'
    $WebProcess = Start-Process `
        -FilePath $VenvPython `
        -ArgumentList @(
            $WebsiteScript,
            "--host", $HostAddress,
            "--port", "$WebPort"
        ) `
        -WorkingDirectory $RepoRoot `
        -NoNewWindow `
        -PassThru

    Wait-ForApi

    $SimulatorUrl = "http://${HostAddress}:${WebPort}/simulator.html?api=http://${HostAddress}:${ApiPort}"
    Write-Host ""
    Write-Host "SpinVault Twin is running locally."
    Write-Host ""
    Write-Host "  Simulator: $SimulatorUrl"
    Write-Host "  API docs:  http://${HostAddress}:${ApiPort}/docs"
    Write-Host ""
    Write-Host "Opening the simulator in your default browser..."
    Write-Host "Keep this window open. Press Ctrl+C to stop."
    Start-Process $SimulatorUrl

    while (-not $ApiProcess.HasExited -and -not $WebProcess.HasExited) {
        Start-Sleep -Seconds 1
    }
    throw "One of the local servers stopped unexpectedly."
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Stop-LocalStack
}
