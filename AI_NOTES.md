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

4. **Built real per-user Slack routing instead of leaving it as a
   documented limitation.** Once the app was actually deployed and
   working, I noticed every user's alerts would go to *my* Slack
   channel, not their own, since the only Slack config was a single
   deployment-wide env var. I was given the option to just document
   this as a known gap (reasonable for a 72-hour exercise) but chose to
   actually fix it — added a per-user `slackWebhookUrl` column and a
   settings page, with the env var kept only as a fallback default.
   This was a deliberate call that a single-tenant shortcut wouldn't
   hold up under "would a reviewer testing with their own repo get
   confusingly routed to someone else's Slack" — worth the extra ~20
   minutes given the brief specifically grades the integration's
   reliability for an arbitrary user, not just for me.

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

## A second one, found during live deployment testing

After deploying to Render, "Sign in with GitHub" failed with a redirect
to `/login?error=oauth_failed` and a 401 in the browser console. The
server logs showed only:
`[auth] OAuth callback failed: ErrorEvent { type: 'error', defaultPrevented: false, cancelable: false, timeStamp: ... }`

No status code, no message — `fetch()` had failed before getting any
HTTP response at all, and Node's built-in fetch (undici) wraps
connection-level failures in a generic `ErrorEvent` instead of a normal
`Error` with a useful message. My first catch block just logged the
bare error object, so the real cause was invisible.

This turned out to be a known class of issue: undici's default connect
timeout (10s) can be too tight in some containerized hosting
environments, where the TCP/TLS handshake to an external host takes
longer than on a typical dev machine — the request aborts before a
response ever comes back, with no distinguishing detail in the error
that bubbles up. It's not specific to this code or to GitHub's API; it
shows up across many unrelated Node + container-host combinations.

Fix was two-part: (1) set a global undici dispatcher with a 30s connect
timeout at the very top of `index.ts`, before any other module can call
`fetch`, and (2) actually log `err.cause` / `err.message` instead of
the bare error object, so if this recurs (or any other outbound call
fails the same way) the logs say something useful instead of an opaque
`ErrorEvent`. I also wrapped the OAuth fetch calls in the same
`withRetry` helper everything else already used — they'd been missed
in the original pass, which was itself a small inconsistency with the
project's own stated convention in `AGENTS.md`.

The instructive part: a low-detail error on a "this should just work"
network call is reason to improve the logging *before* trying more
fixes, not after. Guessing at causes from a content-free stack trace
wastes more time than the 5 minutes it takes to make the error
message say something real.

## A third one: SameSite cookies and the split-deployment architecture

After fixing the database driver, sign-in completed (the OAuth callback
returned a clean 302 instead of erroring), but the dashboard
immediately showed "not authenticated" — `GET /auth/me` came back 401
right after a successful login redirect.

The cause: the frontend (Vercel) and API (Render) are intentionally on
different domains — that split was one of the architecture decisions
documented above. But it has a real consequence for cookies that
doesn't show up in local dev, where both run on `localhost` and are
same-site by definition. The session cookie was set with
`SameSite=Lax`, which is the safer default and correctly survives a
top-level browser redirect (GitHub → our `/auth/github/callback`) — but
`Lax` cookies are *not* attached to `fetch()` calls across origins,
only to top-level navigations. So the cookie landed fine during the
OAuth redirect, then got silently withheld on the very next request
(the dashboard's `fetch('/auth/me')`), making a successful login look
identical to a failed one from the frontend's perspective.

Fixed by using `SameSite=None` (which requires `Secure`, fine since
both deploys are HTTPS) specifically for the session cookie, while
leaving the short-lived OAuth state cookie on `Lax` since it never
needs to survive a `fetch()` call, only the one redirect.

This is the same underlying lesson as the other two bugs in this
file: **local dev same-origin/same-network setups hide a class of bugs
that only appear once you actually deploy across two real domains.**
None of these three issues (undici timeout, Neon-specific driver,
SameSite cookies) would have been caught by `tsc` or even by running
both halves locally against each other — they're all specifically
about what changes when the boundary between client and server
becomes a real network and a real cross-origin browser security model,
rather than `localhost` talking to `localhost`.

## More bugs found during the actual end-to-end test pass

The three bugs above were all "can a user sign in at all." Once that
worked, testing the actual product features (rules, GitHub App
permissions, AI triage) surfaced a different category of problem —
not code bugs, but **gaps between what I assumed a fresh setup would
look like and what GitHub actually does.**

**Wrong Postgres driver for the actual database provider.** My first
deploy used Neon's `@neondatabase/serverless` package, which connects
over Neon's proprietary WebSocket proxy — it doesn't work against any
other Postgres provider. The database ended up being provisioned on
Supabase, not Neon, so every connection failed at the WebSocket
handshake stage with the same opaque `ErrorEvent` pattern as the OAuth
bug, but from a completely different root cause (driver incompatibility,
not a timeout). Fixed by switching to the standard `pg` driver
(`drizzle-orm/node-postgres`), which works with any Postgres host. The
lesson: don't bake in a provider-specific driver when the README offers
a choice of providers — pick the lowest-common-denominator driver
unless there's a specific reason to need the proprietary one.

**GitHub App permission changes don't apply to existing installations.**
After adding the Contents permission (needed to subscribe to `push`
events) to the already-installed GitHub App, push events still weren't
arriving — confirmed via GitHub's own "Recent Deliveries" log showing
zero `push.*` entries despite multiple real pushes. GitHub doesn't
retroactively apply new permissions to installations that predate the
change; the installing user has to explicitly review and accept the
new permission set, and that prompt isn't always obviously surfaced.
Uninstalling and reinstalling fresh picked up the current permission
set immediately and fixed it. Worth knowing for anyone iterating on a
GitHub App's permissions after the first install during development.

**A rule's "Applies to" checkboxes have to be deliberately set per
event type — easy to forget when adding a new one.** A test pull
request matched on title correctly but didn't fire any actions, with
zero action chips in the dashboard (not even a failed one) — which was
itself the useful diagnostic signal: zero chips means the rule didn't
match at all, as opposed to matching and then failing partway through.
The actual cause was mundane: the rule's `eventTypes` only had `issues`
checked, not `pull_request`, from when it was first created — adding a
new event type to test later doesn't retroactively update existing
rules. Not a code bug, but a real usability gap worth knowing about:
the UI doesn't warn "you added pull_request support but your existing
rules don't apply to it yet."

**Gemini model deprecation.** AI triage failed with a 404 — every
Gemini 1.5 model (`gemini-1.5-flash`, the one I'd hardcoded) had been
shut down server-side. This is exactly the kind of fact that goes stale
fast and that I, as a model with a training cutoff, can get wrong with
full confidence — I had to actually search for the current model name
(`gemini-3.1-flash-lite`) rather than trust what I "knew." Fixed two
ways: swapped the model name, and then moved it into a `GEMINI_MODEL`
env var with that as the default, so the next deprecation cycle is a
Render dashboard edit, not a redeploy. Decided to do the env var
version myself rather than just take the one-line fix, since "AI
provider renames/retires a model" is a recurring maintenance cost, not
a one-time fluke.

## What I'd improve with more time

- **Automated tests.** There's no test suite. Given the 72-hour window
  and that this was built in a chat-based environment without a real
  CI loop, I prioritized making the manual "does it actually work
  end-to-end" path solid (verified via real `tsc`/`vite build` passes,
  hand-traced webhook logic, and then a real live test pass covering
  all three event types, label writes, Slack, and AI triage) over
  writing unit tests for the rules engine — which is the one piece I'd
  test first, since `ruleMatches` and `renderTemplate` are pure
  functions with no I/O and would be fast to cover.
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
- **A nudge when a rule's event types don't cover something new.** Now
  that I've personally hit the "added pull_request support, forgot my
  existing rule didn't apply to it yet" gap above, a small UI hint —
  e.g. "this rule only applies to: issues" shown more prominently, or
  a one-click "apply to all subscribed event types" — would have saved
  a full debugging round trip.

## A note on how I worked with the model

Because there was no IDE-integrated agent, I couldn't lean on
file-search/refactor tooling — every file was generated with full
context of the files around it, and verified by literally running
`tsc --noEmit` and `vite build` inside the sandbox after each major
piece, rather than assuming the code was correct. That caught a
handful of small typing issues (Hono's `c.req.param()` returning
`string | undefined` even for params that are guaranteed present by the
route pattern) immediately rather than at deploy time.