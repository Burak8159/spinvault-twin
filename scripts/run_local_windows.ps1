param(
    [string]$PublicDomain = "",
    [switch]$Tunnel
)

$ErrorActionPreference = "Stop"

if (-not $PublicDomain -and $env:SPINVAULT_PUBLIC_DOMAIN) {
    $PublicDomain = $env:SPINVAULT_PUBLIC_DOMAIN.Trim()
}
if (-not $Tunnel -and $env:SPINVAULT_TUNNEL -eq "1") {
    $Tunnel = $true
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$HostAddress = "127.0.0.1"
$ApiPort = if ($env:SPINVAULT_API_PORT) { [int]$env:SPINVAULT_API_PORT } else { 8001 }
$WebPort = if ($env:SPINVAULT_WEB_PORT) { [int]$env:SPINVAULT_WEB_PORT } else { 4191 }
$Venv = Join-Path $RepoRoot "backend\.venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
$ApiProcess = $null
$WebProcess = $null
$TunnelProcess = $null

function Stop-LocalStack {
    Write-Host ""
    Write-Host "Shutting down local stack..."
    foreach ($Process in @($ApiProcess, $WebProcess, $TunnelProcess)) {
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

function Get-CloudflaredCommand {
    $Command = Get-Command "cloudflared.exe" -ErrorAction SilentlyContinue
    if ($null -ne $Command) {
        return $Command.Source
    }
    $Command = Get-Command "cloudflared" -ErrorAction SilentlyContinue
    if ($null -ne $Command) {
        return $Command.Source
    }
    $Local = Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe"
    if (Test-Path $Local) {
        return $Local
    }
    return $null
}

function Write-TunnelSetupHelp([string]$Domain) {
    Write-Host ""
    Write-Host "Public HTTPS for https://$Domain is not live yet."
    Write-Host "This PC is serving the site locally. Cloudflare still needs a one-time tunnel setup."
    Write-Host ""
    Write-Host "  1. winget install --id Cloudflare.cloudflared -e"
    Write-Host "  2. cloudflared tunnel login"
    Write-Host "  3. cloudflared tunnel create spinvault"
    Write-Host "  4. cloudflared tunnel route dns spinvault $Domain"
    Write-Host "  5. cloudflared tunnel route dns spinvault www.$Domain"
    Write-Host "  6. Copy deploy\cloudflared\config.yml.example to %USERPROFILE%\.cloudflared\config.yml"
    Write-Host "     and put the tunnel id + credentials path in that file."
    Write-Host "  7. Double-click HOST_ON_WINDOWS.bat again."
    Write-Host ""
    Write-Host "Full steps: docs\HOSTING_WINDOWS.md"
}

function Start-PublicTunnel([string]$Domain) {
    $Cloudflared = Get-CloudflaredCommand
    if ($null -eq $Cloudflared) {
        Write-TunnelSetupHelp $Domain
        return $null
    }

    $Token = $env:SPINVAULT_CLOUDFLARED_TOKEN
    $ConfigCandidates = @(
        (Join-Path $RepoRoot "deploy\cloudflared\config.yml"),
        (Join-Path $env:USERPROFILE ".cloudflared\config.yml")
    )
    $ConfigPath = $ConfigCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($Token) {
        Write-Host "Starting Cloudflare tunnel with SPINVAULT_CLOUDFLARED_TOKEN..."
        return Start-Process `
            -FilePath $Cloudflared `
            -ArgumentList @("tunnel", "run", "--token", $Token) `
            -WorkingDirectory $RepoRoot `
            -NoNewWindow `
            -PassThru
    }

    if ($ConfigPath) {
        Write-Host "Starting Cloudflare tunnel from $ConfigPath..."
        return Start-Process `
            -FilePath $Cloudflared `
            -ArgumentList @("tunnel", "--config", $ConfigPath, "run") `
            -WorkingDirectory $RepoRoot `
            -NoNewWindow `
            -PassThru
    }

    Write-TunnelSetupHelp $Domain
    return $null
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

    & $VenvPython -c "import fastapi, pydantic_settings, uvicorn, numpy, matplotlib, PIL" 2>$null
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
    $WebArgs = @(
        (Join-Path $RepoRoot "scripts\serve_website.py"),
        "--host", $HostAddress,
        "--port", "$WebPort"
    )
    if ($PublicDomain) {
        $WebArgs += @("--api-proxy", "http://${HostAddress}:${ApiPort}")
    }
    $WebProcess = Start-Process `
        -FilePath $VenvPython `
        -ArgumentList $WebArgs `
        -WorkingDirectory $RepoRoot `
        -NoNewWindow `
        -PassThru

    Wait-ForApi

    if ($Tunnel -and $PublicDomain) {
        $TunnelProcess = Start-PublicTunnel $PublicDomain
    }

    $SimulatorUrl = "http://${HostAddress}:${WebPort}/simulator.html?api=http://${HostAddress}:${ApiPort}"
    $MatplotlibUrl = "http://${HostAddress}:${WebPort}/matplotlib-twin.html?api=http://${HostAddress}:${ApiPort}"
    $RetentionUrl = "http://${HostAddress}:${WebPort}/retention-leakage.html"
    Write-Host ""
    Write-Host "SpinVault Twin is running locally."
    Write-Host ""
    Write-Host "  Simulator:        $SimulatorUrl"
    Write-Host "  Matplotlib Twin:  $MatplotlibUrl"
    Write-Host "  Retention plots:  $RetentionUrl"
    Write-Host "  API docs:         http://${HostAddress}:${ApiPort}/docs"
    if ($PublicDomain) {
        Write-Host ""
        Write-Host "  Public site:      https://$PublicDomain/"
        Write-Host "  Public Twin:      https://$PublicDomain/matplotlib-twin.html"
        Write-Host "  The Twin API stays on 127.0.0.1 and is reached as https://$PublicDomain/api/"
    }
    Write-Host ""
    Write-Host "Opening the matplotlib Twin in your default browser..."
    Write-Host "Keep this window open. Press Ctrl+C to stop. The PC must stay awake for the public site."
    Start-Process $MatplotlibUrl

    while (
        -not $ApiProcess.HasExited -and
        -not $WebProcess.HasExited -and
        ($null -eq $TunnelProcess -or -not $TunnelProcess.HasExited)
    ) {
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
