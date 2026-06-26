import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";
import { verifyGithubSignature } from "../lib/crypto.js";
import { env } from "../lib/env.js";
import { processEvent } from "../lib/event-processor.js";

export const webhookRoutes = new Hono();

const SUPPORTED_EVENTS = new Set(["issues", "pull_request", "push"]);

webhookRoutes.post("/webhooks/github", async (c) => {
  // We need the *raw* body (not parsed JSON) to verify the HMAC
  // signature byte-for-byte — re-serializing parsed JSON can produce a
  // different byte string and break verification.
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  const isValid = verifyGithubSignature(rawBody, signature, env.githubAppWebhookSecret);
  if (!isValid) {
    console.warn("[webhook] rejected: invalid signature");
    // 401 rather than 200 — a forged or misconfigured sender should
    // know it failed, not be told "ok" and silently dropped.
    return c.json({ error: "invalid signature" }, 401);
  }

  const deliveryId = c.req.header("x-github-delivery");
  const eventType = c.req.header("x-github-event");

  if (!deliveryId || !eventType) {
    return c.json({ error: "missing required GitHub headers" }, 400);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid JSON payload" }, 400);
  }

  if (!SUPPORTED_EVENTS.has(eventType)) {
    // Acknowledge politely — there's nothing wrong with the request,
    // we just don't act on this event type. Returning a non-2xx here
    // would make GitHub retry an event we'll never want to process.
    return c.json({ ok: true, ignored: true }, 200);
  }

  const githubInstallationId: number | undefined = payload.installation?.id;
  const githubRepoId: number | undefined = payload.repository?.id;

  let installationRowId: number | null = null;
  let repoRowId: number | null = null;

  if (githubInstallationId) {
    const [install] = await db
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.installationId, githubInstallationId))
      .limit(1);
    installationRowId = install?.id ?? null;
  }
  if (githubRepoId) {
    const [repo] = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.githubRepoId, githubRepoId))
      .limit(1);
    repoRowId = repo?.id ?? null;
  }

  // Idempotent insert: GitHub redelivers webhooks on timeout or 5xx, and
  // operators can also manually "Redeliver" from the GitHub UI. The
  // unique index on delivery_id plus onConflictDoNothing means a
  // redelivered event is recorded at most once — we detect that via
  // `returning()` coming back empty and skip reprocessing entirely.
  const inserted = await db
    .insert(schema.events)
    .values({
      deliveryId,
      eventType,
      action: payload.action ?? null,
      installationId: installationRowId,
      repoId: repoRowId,
      payload,
      status: "received",
    })
    .onConflictDoNothing({ target: schema.events.deliveryId })
    .returning();

  if (inserted.length === 0) {
    console.log(`[webhook] duplicate delivery ${deliveryId}, skipping`);
    return c.json({ ok: true, duplicate: true }, 200);
  }

  const eventRow = inserted[0];

  // Respond to GitHub immediately, then process in the background.
  // GitHub enforces a response timeout on webhook deliveries; if our
  // action chain (GitHub API + Slack + AI call, each with retries)
  // ran inline, a slow downstream call could cause GitHub to time out
  // and redeliver — which our idempotency handles, but it's cleaner
  // and faster to just not block the response on it.
  processEvent(eventRow.id).catch((err) => {
    console.error(`[webhook] background processing crashed for event ${eventRow.id}:`, err);
  });

  return c.json({ ok: true, eventId: eventRow.id }, 200);
});
