# GitHub Automation Bot

Sign in with GitHub, connect a repository, and define rules like
"issues whose title contains `bug` → add the `bug` label and alert
Slack." The bot listens for GitHub webhooks, runs your rules, writes
back to GitHub, and shows a live activity log in a dashboard.

**Live app:** _fill in your Vercel URL here_
**API:** _fill in your Render URL here_

## How it's built

- `server/` — Node + TypeScript + [Hono](https://hono.dev), Postgres via
  [Drizzle ORM](https://orm.drizzle.team), deployed to **Render**.
- `web/` — React + Vite SPA, deployed to **Vercel**.
- Database: [Neon](https://neon.tech) (serverless Postgres, free tier).
- Auth: GitHub OAuth for sign-in, a separate **GitHub App** installation
  for repo access + webhooks (see "Why two GitHub integrations?" below).
- Notifications: Slack Incoming Webhook.
- AI triage (optional): Google Gemini free tier.

## Why two GitHub integrations?

This trips a lot of people up, so worth explaining up front:

- **"Login with GitHub" (OAuth App)** answers "who is this person?" —
  it's how a human signs in. It does **not** grant any access to repos.
- **The GitHub App** answers "which repos can the bot touch, and how do
  webhooks get there?" Installing the App on an account is what wires
  up webhook delivery and grants scoped API access (via short-lived
  installation tokens) — no manual webhook setup needed.

A user signs in once (OAuth), then separately installs the App on
whichever account/repos they want automated. You can sign in without
ever installing the App; you just won't have anything to automate yet.

## Local setup

Requires Node 20+.

### 1. Database

Create a free Postgres database at [neon.tech](https://neon.tech) (no
card required). Copy the connection string.

### 2. GitHub OAuth App (for sign-in)

[github.com/settings/developers](https://github.com/settings/developers) → New OAuth App.

- Homepage URL: `http://localhost:5173`
- Authorization callback URL: `http://localhost:8080/auth/github/callback`

Copy the Client ID and generate a Client Secret.

### 3. GitHub App (for repo access + webhooks)

[github.com/settings/apps](https://github.com/settings/apps) → New GitHub App.

- Homepage URL: `http://localhost:5173`
- Callback URL: `http://localhost:8080/install/callback`, check "Request user authorization (OAuth) during installation" is **off** (we don't need it — installation alone is enough)
- Webhook URL: for local dev you need a public tunnel, e.g. `ngrok http 8080`, then use `https://<your-ngrok-id>.ngrok-free.app/webhooks/github`
- Webhook secret: make up any random string, you'll need it below
- Permissions: **Issues** (Read & write), **Pull requests** (Read & write), **Metadata** (Read-only)
- Subscribe to events: **Issues**, **Pull request**, **Push**
- Where can this be installed: **Any account**

After creating it, note the **App ID**, the **slug** (from the app's
URL), and generate + download a **private key** (.pem file).

### 4. Slack

Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
→ From scratch. Under **Incoming Webhooks**, activate it and "Add New
Webhook to Workspace," choosing a channel. Copy the generated URL.

### 5. Gemini (optional, for AI triage)

Get a free key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
Leave blank to run without the AI step.

### 6. Run it

```bash
# Server
cd server
cp .env.example .env   # fill in everything from steps 1-5
npm install
npm run db:migrate
npm run dev             # http://localhost:8080

# Web (separate terminal)
cd web
cp .env.example .env.local
npm install
npm run dev              # http://localhost:5173
```

Open `http://localhost:5173`, sign in, then go to **Repositories** →
**Connect a repository** to install the GitHub App and pick a repo. Open
an issue on that repo (or use GitHub's webhook "Redeliver" feature on a
past delivery) to see it land in **Activity**.

## Deployment

### Server → Render

1. Push this repo to GitHub.
2. New Web Service on [render.com](https://render.com) → connect the
   repo → root directory `server` (a `render.yaml` is included, so
   Render can pick most of this up automatically via "New → Blueprint").
3. Set every variable from `server/.env.example` in the Render
   dashboard. `WEB_ORIGIN` is your Vercel URL, `API_ORIGIN` is this
   Render service's own URL.
4. Build command: `npm install && npm run build`. Start command:
   `npm run db:migrate && npm start` (runs migrations on every boot —
   harmless if there's nothing new to apply).

### Web → Vercel

1. New Project on [vercel.com](https://vercel.com) → import the repo →
   root directory `web`.
2. Set `VITE_API_ORIGIN` to your Render URL.
3. Deploy.

### After both are live

Go back and update:
- The GitHub OAuth App's callback URL to `<render-url>/auth/github/callback`
- The GitHub App's webhook URL to `<render-url>/webhooks/github`, and its callback URL to `<render-url>/install/callback`
- `WEB_ORIGIN` and `API_ORIGIN` on Render to the real URLs (not localhost)

## Reliability & security notes

(See the take-home brief's "quality bar" — this is how each point is addressed.)

- **Forged/replayed requests:** every webhook is verified against
  `X-Hub-Signature-256` using a constant-time HMAC comparison before
  anything else happens (`server/src/lib/crypto.ts`).
- **Duplicate delivery:** GitHub's `X-GitHub-Delivery` id is unique-
  indexed in the database; a redelivered event is detected via
  `ON CONFLICT DO NOTHING` and never reprocessed
  (`server/src/routes/webhooks.ts`).
- **Downstream outages:** every outbound call (GitHub API, Slack,
  Gemini) goes through a shared retry-with-backoff helper
  (`server/src/lib/retry.ts`), and every attempted action is logged to
  `action_logs` with its status, so a failure is visible in the
  dashboard instead of silently dropped.
- **Secrets:** all live in environment variables, loaded once through
  `server/src/lib/env.ts`, never logged. `.env` is gitignored;
  `.env.example` ships with no real values.

## What's not done / known limitations

See `AI_NOTES.md` for the honest version of this, including the
hardest bug encountered while building it.
