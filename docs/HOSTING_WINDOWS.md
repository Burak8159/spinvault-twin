# Host SpinVault Twin at https://spinvault.biz

This is a home-PC host. The website and Twin API stay on `127.0.0.1`. Cloudflare
opens an outbound tunnel so you do **not** port-forward 80/443 and you do **not**
bind the Python servers to the public internet. The public helper pauses before
starting and requires an explicit confirmation that Cloudflare Access is already
protecting the hostname. The confirmation is an operator check, not an automatic
verification of Cloudflare configuration.

Requests that reach the public site can submit Twin jobs that run on this PC.
Only expose it to intended, authenticated users; keep the host window closed when
you are not actively demoing.

## One-time Cloudflare setup

1. Add `spinvault.biz` to a Cloudflare account and switch the domain nameservers
   to the two names Cloudflare shows. Wait until the dashboard says the domain
   is active.
2. On the Windows PC, install the tunnel client:

   ```bat
   winget install --id Cloudflare.cloudflared -e
   ```

   Close and reopen Terminal after install so `cloudflared` is on PATH.
3. Log in and create a named tunnel:

   ```bat
   cloudflared tunnel login
   cloudflared tunnel create spinvault
   cloudflared tunnel route dns spinvault spinvault.biz
   cloudflared tunnel route dns spinvault www.spinvault.biz
   ```

   The `create` command prints a tunnel id and writes
   `%USERPROFILE%\.cloudflared\<TUNNEL_ID>.json`.
4. Copy `deploy\cloudflared\config.yml.example` to
   `%USERPROFILE%\.cloudflared\config.yml`. Put the tunnel id and the full path
   to that `.json` credentials file in it.

If you created the tunnel in the Cloudflare Zero Trust dashboard instead, skip
the config file and set a user environment variable
`SPINVAULT_CLOUDFLARED_TOKEN` to the token Cloudflare shows.

## Every time you want the public site live

1. In Cloudflare Zero Trust, create a self-hosted Access application covering
   both `spinvault.biz` and `www.spinvault.biz`, all paths (especially `/api/*`).
2. Add an allow policy limited to the intended team identities and ensure there
   is no bypass or public policy. Do not use “everyone” as the allowed audience.
3. Verify in a private browser that the site and `/api/solvers` require login,
   then verify an authenticated intended user can reach the app.
4. On the Windows PC, extract/open this repo and double-click
   **`HOST_ON_WINDOWS.bat`**. At the prompt, type `ACCESS_CONFIGURED` only after
   completing and checking steps 1–3. Otherwise cancel and use local-only
   `RUN_ON_WINDOWS.bat`.
5. Leave the host window open while demoing. Sleep/hibernate takes the site
   offline; close the window when the demo is over.

Local URLs still work:

- http://127.0.0.1:4191/index.html
- http://127.0.0.1:4191/matplotlib-twin.html

Public URLs after the tunnel is up:

- https://spinvault.biz/
- https://spinvault.biz/matplotlib-twin.html
- https://spinvault.biz/api/solvers

`RUN_ON_WINDOWS.bat` is unchanged: local only, no tunnel.

## Checks

- `https://spinvault.biz/` loads the company site.
- `https://spinvault.biz/matplotlib-twin.html` can submit a short Python mesh run.
- The Twin API process is listening only on `127.0.0.1:8001`, not on the LAN.
