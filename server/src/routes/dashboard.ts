import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { eq, inArray, desc, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";

export const dashboardRoutes = new Hono();

const VALID_EVENT_TYPES = new Set(["issues", "pull_request", "push"]);

/** Returns recent events across all repos the logged-in user owns, newest first. */
dashboardRoutes.get("/dashboard/events", requireAuth, async (c) => {
  const user = c.get("user");

  const myRepos = await db
    .select({ id: schema.repos.id, fullName: schema.repos.fullName })
    .from(schema.repos)
    .where(eq(schema.repos.ownerUserId, user.id));

  if (myRepos.length === 0) {
    return c.json({ events: [] });
  }

  const repoIds = myRepos.map((r) => r.id);
  const repoNameById = new Map(myRepos.map((r) => [r.id, r.fullName]));

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  // Parse optional eventType filter — comma-separated list of event types.
  // We validate each value against a whitelist so arbitrary strings can't
  // be injected into the query. Invalid or unknown types are silently
  // dropped; if nothing valid remains we treat it as "no filter."
  const eventTypeParam = c.req.query("eventType");
  const filteredTypes = eventTypeParam
    ? eventTypeParam.split(",").map((t) => t.trim()).filter((t) => VALID_EVENT_TYPES.has(t))
    : [];

  const whereCondition = filteredTypes.length > 0
    ? and(inArray(schema.events.repoId, repoIds), inArray(schema.events.eventType, filteredTypes))
    : inArray(schema.events.repoId, repoIds);

  const rows = await db
    .select()
    .from(schema.events)
    .where(whereCondition)
    .orderBy(desc(schema.events.receivedAt))
    .limit(limit);

  const eventIds = rows.map((r) => r.id);
  const actionRows = eventIds.length
    ? await db.select().from(schema.actionLogs).where(inArray(schema.actionLogs.eventId, eventIds))
    : [];
  const actionsByEvent = new Map<number, typeof actionRows>();
  for (const a of actionRows) {
    const list = actionsByEvent.get(a.eventId) ?? [];
    list.push(a);
    actionsByEvent.set(a.eventId, list);
  }

  const events = rows.map((r) => ({
    id: r.id,
    eventType: r.eventType,
    action: r.action,
    repoFullName: r.repoId ? repoNameById.get(r.repoId) ?? "unknown" : "unknown",
    status: r.status,
    receivedAt: r.receivedAt,
    aiSummary: r.aiSummary,
    aiSuggestedLabel: r.aiSuggestedLabel,
    aiPriority: r.aiPriority,
    title: (r.payload as any)?.issue?.title ?? (r.payload as any)?.pull_request?.title ?? (r.payload as any)?.head_commit?.message ?? null,
    actions: (actionsByEvent.get(r.id) ?? []).map((a) => ({
      id: a.id,
      actionType: a.actionType,
      target: a.target,
      status: a.status,
      lastError: a.lastError,
    })),
  }));

  return c.json({ events });
});