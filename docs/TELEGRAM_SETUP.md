# Telegram copilot bot — setup

The copilot can answer over Telegram. The brain is the same grounded engine as the
web app (numbers come from the calc engine; the model only phrases). This doc is the
one-time account setup; the code is already in the app.

## Architecture

```
Telegram  ──update──▶  POST /api/telegram/webhook  (verified by secret header)
                          │
                          ├─ /link <code>  → binds this chat to a household
                          └─ free-form text → copilotAnswer(household, latest period) ──▶ reply
```

- **No inbound message is trusted without a link.** A chat only gets answers after it is
  bound to a household via a one-time code generated in the web app (Settings → Connect
  Telegram). The code is single-use, expires in 15 minutes, and only its SHA-256 hash is stored.
- **Tenant isolation holds:** the household is resolved from the verified chat binding, then
  passed to the same `copilotAnswer` the web uses — the bot can't see another household's data.
- **Webhook auth:** Telegram echoes a shared secret in the `X-Telegram-Bot-Api-Secret-Token`
  header; the worker rejects anything else. The bot stays fully disabled until the token +
  secret are set.

## One-time setup

### 1. Create the bot
In Telegram, message **@BotFather** → `/newbot` → follow prompts. You get:
- a **bot token** like `123456:ABC-DEF...` → this is `TELEGRAM_BOT_TOKEN`
- a **bot username** like `hfos_copilot_bot` → this is `TELEGRAM_BOT_USERNAME`

### 2. Pick a webhook secret
Any long random string → this is `TELEGRAM_WEBHOOK_SECRET` (e.g. `openssl rand -hex 32`).

### 3. Add the secrets
GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | your random string |

The deploy workflow syncs both to the Worker on the next deploy (only when set). Optionally set
the non-secret `TELEGRAM_BOT_USERNAME` in `web/wrangler.toml` so Settings can show a one-tap
`t.me` deep link (otherwise it shows the code to paste).

Push to `main` (or re-run the Deploy workflow) so the Worker picks up the secrets.

### 4. Register the webhook (once)
Point Telegram at the Worker, passing the same secret. Replace the token and your app domain:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-app-domain>/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Verify with `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` (should show your URL and
no `last_error_message`). To stop the bot: `deleteWebhook`.

## Using it
1. In the app: **Settings → Connect Telegram → Generate link code**.
2. In Telegram: open the bot and send `/link <code>` (or tap the deep link).
3. Ask anything, e.g. *"are we over budget this month?"*. Commands: `/help`, `/whoami`, `/unlink`.

## Notes & limits
- Answers use the current copilot provider (`auto` by default: free Workers AI → Claude spillover).
- Bot replies are plain text (no formatting to escape). Long answers are capped at Telegram's 4096 chars.
- One binding per chat; re-linking replaces it. `/unlink` (or Settings → Disconnect) removes it.
- Financial figures traverse Telegram's cloud (bot chats are not end-to-end encrypted) — a
  deliberate trade-off for convenience, same class of consideration as any messaging channel.
