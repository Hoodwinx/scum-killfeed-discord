# SCUM Killfeed → Discord

Node.js server-side relay for SCUM `kill_*.log` files. Reads local logs or remote SFTP logs and sends newly parsed deaths to a Discord webhook.

## Quick start

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `SOURCE=local` and `LOCAL_LOG_DIR`, or `SOURCE=sftp` and the SFTP connection variables.
5. Create a webhook in Discord under **Edit Channel → Integrations → Webhooks** and set `DISCORD_WEBHOOK_URL`.
6. Test with `DRY_RUN=true` and `npm start`, then set `DRY_RUN=false` to post live events.
7. Run parser tests with `npm test`.

On first run, existing log history is skipped by default. Set `BACKFILL=true` before first run if you intentionally want history imported (may produce many Discord messages). Read progress is stored in `data/state.json`.

## Architecture

SCUM kill logs → local/SFTP polling → kill parser → Discord webhook

This is a **server-side relay, not an in-game mod**. The Discord webhook works without a Discord bot token. A true Discord bot with commands and stats can be added later.

## Caveats

- SCUM log formats may differ across hosts and versions. Validate against redacted real kill logs before production.
- This version reads the complete log files each poll. For large servers, optimize for ranged reads.
- Failed deliveries are retried; a crash between posting and state saving could duplicate an event.
- Keep `.env` private and never commit server passwords or webhooks.
- If deploying on an Ubuntu VPS with PM2: `pm2 start src/index.js --name scum-killfeed && pm2 save`.
