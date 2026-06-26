# AI_NOTES.md

## Tools and split of work

Built entirely with Claude (Sonnet 4.6) in a chat-based environment with
a sandboxed Linux container — no Claude Code or other IDE agent was
available for this exercise, so the whole repo was generated, type-
checked, and built file-by-file in that environment, then handed off as
a download. I (the human) drove every architectural decision up front
through a short Q&A — stack, deploy targets, how deep to go on stretch
goals, auth model — before any code was written, then reviewed the
generated code, the schema, and the README rather than writing
boilerplate by hand. Roughly: 90% of raw code volume came from the
model, 100% of the architecture decisions and all the "is this actually
secure / does this actually satisfy the brief" review came from me.

## Key decisions I made myself

1. **Split the GitHub App (repo access) from GitHub OAuth (sign-in)
   instead of using one OAuth app for both.** This is more setup work
   (two GitHub-side integrations instead of one) but it's what
   real products do — sign-in shouldn't require granting repo write
   access, and a GitHub App gets scoped, revocable, per-repo
   installation tokens instead of a single broad personal-access-style
   token. It also means the user never has to manually paste a webhook
   URL into their repo settings — installing the App does that.

2. **Two separate deployables (Hono API on Render, static React SPA on
   Vercel) instead of one full-stack framework like Next.js.** I'd
   already decided I wanted Hono specifically for the API, and once
   that's true, gluing a Vite SPA on top of it is simpler and more
   honest about the architecture than forcing everything into one
   Next.js app — it's also closer to how this would actually be split
   in a real company (API team vs. frontend team, different scaling
   characteristics).

3. **Idempotency and retry as DB-level guarantees, not in-memory
   checks.** I specifically asked for the unique constraint on
   `delivery_id` with `ON CONFLICT DO NOTHING` rather than an in-memory
   "seen events" set, because the brief explicitly grades "does it
   survive redelivery / does it survive a brief outage," and an
   in-memory check fails the moment there's more than one server
   instance or a restart. This was the single most important decision
   for satisfying the "quality bar" section of the brief, and it's the
   kind of thing that's easy for an LLM to skip if you don't ask for it
   explicitly — the first draft of similar systems I've seen tend to
   reach for an in-memory Set first because it's simpler to write.

## The hardest bug / wrong turn

The trickiest part was the relationship between three different
"installation id" concepts that all look interchangeable but aren't:

- GitHub's own installation id (a number GitHub assigns, used in API
  URLs and in the webhook payload's `installation.id`)
- our internal `installations.id` (a Postgres serial, used as the
  foreign key from `repos.installation_id`)
- the short-lived **installation access token** you get by exchanging
  the App's JWT for that GitHub installation id

Early in writing the event processor, I had `repos.installationId`
(our internal id) flowing directly into the function that calls
GitHub's API to add a label — but that function needs GitHub's
installation id to request an access token, not our internal row id.
Two numbers that are both small integers, both called "installation
id," and both plausible-looking in context — exactly the kind of bug
that compiles fine, runs fine in the happy path during a quick mental
trace, and then fails confusingly the first time the numbers actually
diverge (which they will, since our serial ids start at 1 and GitHub's
installation ids are large numbers in the millions).

I caught it by reasoning through the call chain end-to-end rather than
trusting that "installationId" meant the same thing everywhere it
appeared, and the fix was to add an explicit resolution step
(`getInstallationGithubId` in `event-processor.ts`) that looks up the
internal row and returns GitHub's id, with a name specific enough that
the two concepts can't be silently swapped again. This is also why
`AGENTS.md` calls out the OAuth-vs-App distinction explicitly — the
underlying lesson generalizes: any time two integrations both produce
something called "an id," name the variables after which system the id
belongs to, not after the generic concept.

## What I'd improve with more time

- **Automated tests.** There's no test suite. Given the 72-hour window
  and that this was built in a chat-based environment without a real
  CI loop, I prioritized making the manual "does it actually work
  end-to-end" path solid (verified via real `tsc`/`vite build` passes
  and a hand-traced webhook flow) over writing unit tests for the rules
  engine — which is the one piece I'd test first, since `ruleMatches`
  and `renderTemplate` are pure functions with no I/O and would be fast
  to cover.
- **Websockets instead of polling for the dashboard.** It currently
  polls every 8 seconds, which is simple and reliable but not
  instantaneous.
- **Multi-repo rule conflicts.** Right now rules with `repoId: null`
  apply to every enabled repo a user owns; there's no UI affordance yet
  for "this rule is currently active on 4 repos," which could surprise
  someone who forgets they set a global rule.
- **A dead-letter view.** `action_logs` records failures, but there's
  no "retry this failed action" button in the dashboard yet — you'd
  have to trigger a redelivery from GitHub's side to get a retry today.
- **Structured log shipping.** Logs go to stdout (visible in Render's
  log viewer) but aren't shipped anywhere queryable; for a real
  on-call setup I'd want them in something searchable.

## A note on how I worked with the model

Because there was no IDE-integrated agent, I couldn't lean on
file-search/refactor tooling — every file was generated with full
context of the files around it, and verified by literally running
`tsc --noEmit` and `vite build` inside the sandbox after each major
piece, rather than assuming the code was correct. That caught a
handful of small typing issues (Hono's `c.req.param()` returning
`string | undefined` even for params that are guaranteed present by the
route pattern) immediately rather than at deploy time.
