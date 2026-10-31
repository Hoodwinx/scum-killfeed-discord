# Deploy on a Windows SCUM dedicated server

This is a local log-file relay. It does not modify SCUM or require an in-game mod.

## 1. Find the kill logs

On the server, find `SCUM\Saved\SaveFiles\Logs` beneath the SCUM server installation. Look for `kill_*.log`. Do not confuse it with the engine log folder `SCUM\Saved\Logs`.

From PowerShell:

```powershell
Get-CimInstance Win32_Process -Filter "name='SCUMServer.exe'" | Select-Object ExecutablePath
Get-ChildItem "C:\SCUM_Server\SCUM\Saved\SaveFiles\Logs" -Filter 'kill_*.log' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

Replace the example installation folder with your own.

## 2. Install relay

- Install Node.js 20 or later on the machine where the relay will run.
- Download or clone this repository to e.g. `C:\scum-killfeed-discord`.
- Run `npm install` and `npm test` from PowerShell in that directory.
- Copy `.env.example` to `.env` and set:
  - `SOURCE=local`
  - `LOCAL_LOG_DIR=C:\SCUM_Server\SCUM\Saved\SaveFiles\Logs` (replace with real path)
  - `DRY_RUN=true` for first test
  - `POLL_SECONDS=15`
- Run `npm start`.

The first poll skips historical entries by default. With the game running, generate a **new** kill/death and confirm the console prints a parsed event. If you need a controlled replay of history, stop the relay, delete `data\state.json` and set `BACKFILL=true`. Do this only with `DRY_RUN=true` first to avoid flooding Discord.

## 3. Discord webhook

In the destination Discord channel, open Edit Channel → Integrations → Webhooks and create/copy a webhook URL. Treat it as a secret. Set `DISCORD_WEBHOOK_URL=...` and `DRY_RUN=false` in `.env`. Restart `npm start`. Generate a new game kill and verify the channel receives an embed.

The webhook is outbound HTTPS, so no router port-forwarding is needed for the relay.

## 4. Keep running

For a simple unattended Windows deployment use Task Scheduler:

- Create Task → General → Run whether user is logged on or not.
- Trigger → At startup (optionally delay 30 seconds).
- Action → Start a program: `C:\Program Files\nodejs\node.exe`
- Add arguments: `src\index.js`
- Start in: `C:\scum-killfeed-discord` (adjust path).
- Enable restart on failure in Settings.

Run the task with a Windows account that has **read** permission on SCUM's log directory and write access to the relay's `data` directory. Do not run as administrator unless actually needed.

## Troubleshooting

- No matching files: confirm you are looking in the dedicated server's `SaveFiles\Logs` folder and have had an in-game death since launch.
- Files exist but nothing posts: inspect `DRY_RUN`, `data\state.json`, source path, file timestamps and the console; by default older deaths are skipped.
- Parser outputs nothing for real new deaths: redact SteamIDs, player identities, IPs, and location coordinates from a few raw log lines and compare to `src/parser.js`. SCUM log formats may change.
- Webhook errors: confirm the URL, Discord channel permissions and outbound HTTPS connectivity.
- Never commit `.env`, webhook URLs or passwords.
