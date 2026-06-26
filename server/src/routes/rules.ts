import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";
import type { RuleConditions, RuleActions } from "../lib/rules-engine.js";

export const rulesRoutes = new Hono();

const VALID_EVENT_TYPES = new Set(["issues", "pull_request", "push"]);
const VALID_FIELDS = new Set(["title", "body", "author", "label"]);
const VALID_MATCH_TYPES = new Set(["contains", "equals", "regex"]);

function validateConditions(conditions: any): conditions is RuleConditions {
  if (!conditions || !Array.isArray(conditions.eventTypes) || !Array.isArray(conditions.matches)) return false;
  if (!conditions.eventTypes.every((e: any) => VALID_EVENT_TYPES.has(e))) return false;
  return conditions.matches.every(
    (m: any) =>
      m && typeof m.value === "string" && VALID_FIELDS.has(m.field) && VALID_MATCH_TYPES.has(m.type)
  );
}

function validateActions(actions: any): actions is RuleActions {
  if (!actions || typeof actions !== "object") return false;
  if (actions.addLabel !== undefined && typeof actions.addLabel !== "string") return false;
  if (actions.comment !== undefined && typeof actions.comment !== "string") return false;
  if (actions.slackAlert !== undefined && typeof actions.slackAlert !== "boolean") return false;
  return true;
}

rulesRoutes.get("/rules", requireAuth, async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(schema.rules)
    .where(eq(schema.rules.userId, user.id))
    .orderBy(schema.rules.priority);
  return c.json({ rules: rows });
});

rulesRoutes.post("/rules", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }
  if (!validateConditions(body.conditions)) {
    return c.json({ error: "invalid conditions" }, 400);
  }
  if (!validateActions(body.actions)) {
    return c.json({ error: "invalid actions" }, 400);
  }

  // If a repoId was supplied, confirm it actually belongs to this user
  // — otherwise a user could attach a rule to (and later infer info
  // about) a repo that isn't theirs.
  if (body.repoId) {
    const [repo] = await db
      .select()
      .from(schema.repos)
      .where(and(eq(schema.repos.id, body.repoId), eq(schema.repos.ownerUserId, user.id)))
      .limit(1);
    if (!repo) return c.json({ error: "repo not found or not yours" }, 403);
  }

  const [created] = await db
    .insert(schema.rules)
    .values({
      userId: user.id,
      repoId: body.repoId ?? null,
      name: body.name,
      enabled: body.enabled ?? true,
      priority: body.priority ?? 0,
      conditions: body.conditions,
      actions: body.actions,
    })
    .returning();

  return c.json({ rule: created }, 201);
});

rulesRoutes.patch("/rules/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id")!, 10);
  const body = await c.req.json();

  const [existing] = await db
    .select()
    .from(schema.rules)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.userId, user.id)))
    .limit(1);
  if (!existing) return c.json({ error: "not found" }, 404);

  if (body.conditions !== undefined && !validateConditions(body.conditions)) {
    return c.json({ error: "invalid conditions" }, 400);
  }
  if (body.actions !== undefined && !validateActions(body.actions)) {
    return c.json({ error: "invalid actions" }, 400);
  }

  const [updated] = await db
    .update(schema.rules)
    .set({
      name: body.name ?? existing.name,
      enabled: body.enabled ?? existing.enabled,
      priority: body.priority ?? existing.priority,
      conditions: body.conditions ?? existing.conditions,
      actions: body.actions ?? existing.actions,
    })
    .where(eq(schema.rules.id, id))
    .returning();

  return c.json({ rule: updated });
});

rulesRoutes.delete("/rules/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id")!, 10);

  const [existing] = await db
    .select()
    .from(schema.rules)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.userId, user.id)))
    .limit(1);
  if (!existing) return c.json({ error: "not found" }, 404);

  await db.delete(schema.rules).where(eq(schema.rules.id, id));
  return c.json({ ok: true });
});
