# Host SpinVault Twin at https://spinvault.biz

This is a home-PC host. The website and Twin API stay on `127.0.0.1`. Cloudflare
opens an outbound tunnel so you do **not** port-forward 80/443 and you do **not**
bind the Python servers to the public internet.

Anyone who can open `https://spinvault.biz` can submit Twin jobs that run on this
PC. Keep the window closed when you are not demoing.

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

1. On the Windows PC, extract/open this repo.
2. Double-click **`HOST_ON_WINDOWS.bat`**.
3. Leave that window open. Sleep/hibernate will take the site offline.

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
