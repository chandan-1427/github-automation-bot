import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";

export const settingsRoutes = new Hono();

settingsRoutes.get("/settings", requireAuth, async (c) => {
  const user = c.get("user");
  const [row] = await db
    .select({ slackWebhookUrl: schema.users.slackWebhookUrl })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  return c.json({ slackWebhookUrl: row?.slackWebhookUrl ?? null });
});

settingsRoutes.patch("/settings", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ slackWebhookUrl?: string | null }>();

  if (body.slackWebhookUrl && !body.slackWebhookUrl.startsWith("https://hooks.slack.com/")) {
    return c.json({ error: "That doesn't look like a Slack Incoming Webhook URL (should start with https://hooks.slack.com/)" }, 400);
  }

  await db
    .update(schema.users)
    .set({ slackWebhookUrl: body.slackWebhookUrl?.trim() || null })
    .where(eq(schema.users.id, user.id));

  return c.json({ ok: true });
});