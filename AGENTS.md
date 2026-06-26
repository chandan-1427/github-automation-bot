# AGENTS.md

Context for AI coding assistants (Claude, Copilot, Codex, etc.) working in this repo.

## What this is

A GitHub automation bot: a user signs in with GitHub, installs a GitHub
App on a repo, and the app reacts to webhooks (issues, PRs, pushes) by
running user-defined rules that add labels, post comments, and send
Slack alerts. There's an optional AI triage step (Gemini) on newly
opened issues/PRs.

## Repo layout

- `server/` — Hono + TypeScript API on Node, deployed to Render.
  - `src/db/schema.ts` — Drizzle ORM schema, the source of truth for the data model.
  - `src/lib/` — all external integrations and core logic live here, one file per concern
    (github-app.ts, github-oauth.ts, slack.ts, gemini.ts, rules-engine.ts, event-processor.ts).
  - `src/routes/` — Hono route handlers, thin — they call into `lib/`, they don't contain business logic.
- `web/` — React + Vite SPA, deployed to Vercel. Talks to the API over fetch with `credentials: "include"`.

## Conventions to follow

- **Don't put business logic in route handlers.** Routes parse/validate
  input, call a function in `lib/`, and return JSON. If you're writing
  an `if` statement that isn't about HTTP status codes or auth, it
  probably belongs in `lib/`.
- **Every outbound integration call (GitHub API, Slack, Gemini) goes
  through `withRetry`** (`lib/retry.ts`). Don't call `fetch` directly
  for these — wrap it.
- **Every webhook-triggered action gets a row in `action_logs` before
  it runs**, not after. See `runAction` in `event-processor.ts`. This is
  intentional: if the process crashes mid-action, the dashboard should
  still show "pending"/"failed" rather than nothing.
- **Idempotency is enforced at the DB level**, not in application logic
  — the unique index on `events.delivery_id` plus `onConflictDoNothing`
  is what makes duplicate webhook deliveries safe. Don't add an
  in-memory "have I seen this" check; it won't survive a restart and
  will race across instances if we ever scale beyond one.
- **Never log secret values.** `env.ts` is the only place that should
  read secret env vars directly; everything else imports from there.
- **GitHub OAuth (Login) and the GitHub App (repo access) are
  deliberately separate concepts.** A `users` row is identity. An
  `installations` row is what actually grants repo access and webhook
  delivery. Don't conflate them — a user can be signed in with zero
  installations, and that's a normal, valid state (just show "connect a
  repo" in the UI).

## Things that look like bugs but aren't

- The webhook route returns `200 { ok: true, ignored: true }` for event
  types we don't support, rather than a 4xx. This is intentional — a
  4xx/5xx makes GitHub retry the delivery, which would retry forever
  for an event type we'll never act on.
- `processEvent()` is called and NOT awaited in the webhook handler. This
  is intentional — we ack GitHub fast, then process in the background.
  On Render (long-running Node process) this is safe. If this is ever
  ported to a serverless platform (Vercel functions, Lambda), this
  pattern breaks — the function may be killed before the background
  work finishes. Don't "fix" this by adding `await` without considering
  GitHub's webhook delivery timeout first.

## Testing changes locally

There's no automated test suite (see AI_NOTES.md for why, given the
72-hour window). To sanity check a change to the webhook/rules path:

1. Run `server` locally with `npm run dev`, point a tunnel
   (e.g. `ngrok http 8080`) at it, and update the GitHub App's webhook
   URL to the tunnel URL temporarily.
2. Or: use GitHub's "Redeliver" button on a past webhook delivery
   (Settings → Developer settings → GitHub Apps → your app → Advanced)
   to resend a real payload without needing a live event.

## What NOT to do

- Don't add a new ORM or query builder — Drizzle is already wired up
  and the schema is the source of truth.
- Don't switch the frontend to Next.js or merge it into the server —
  the split into two deployables (Render API + Vercel static SPA) was
  a deliberate choice, see AI_NOTES.md.
- Don't introduce a paid API or service. Everything in this project
  must run on free tiers — see the take-home brief's constraints.
