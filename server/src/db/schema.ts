import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * A human who has signed in with "Login with GitHub" (OAuth).
 * This is identity only — it does NOT imply repo access.
 * Repo access comes from `installations` (GitHub App).
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  githubId: bigint("github_id", { mode: "number" }).notNull(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  githubIdIdx: uniqueIndex("users_github_id_idx").on(t.githubId),
}));

/**
 * Server-side session, referenced by an opaque id stored in an httpOnly
 * cookie. Kept in DB (rather than pure JWT) so a session can be revoked
 * (logout, or an admin kill-switch) without waiting for token expiry.
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // random id, the cookie value
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

/**
 * A GitHub App installation. Created when a user installs the app on
 * an account (themselves or an org they admin). One installation can
 * grant access to many repos.
 */
export const installations = pgTable("installations", {
  id: serial("id").primaryKey(),
  installationId: bigint("installation_id", { mode: "number" }).notNull(),
  accountLogin: text("account_login").notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  installationIdIdx: uniqueIndex("installations_installation_id_idx").on(t.installationId),
}));

/**
 * A specific repository the user has chosen to enable bot automation on.
 * `enabled` lets a user pause automation without uninstalling the app.
 */
export const repos = pgTable("repos", {
  id: serial("id").primaryKey(),
  githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull(),
  fullName: text("full_name").notNull(), // e.g. "octocat/hello-world"
  installationId: integer("installation_id").notNull().references(() => installations.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  githubRepoIdIdx: uniqueIndex("repos_github_repo_id_idx").on(t.githubRepoId),
}));

/**
 * A user-configured automation rule. `repoId` null = applies to all of
 * the user's enabled repos. Conditions and actions are stored as jsonb
 * so the schema doesn't need to change as match/action types grow.
 *
 * conditions: { eventTypes: string[], matches: [{ field, type, value }] }
 *   field: "title" | "body" | "author" | "label"
 *   type:  "contains" | "equals" | "regex"
 * actions: { addLabel?: string, comment?: string, slackAlert?: boolean }
 */
export const rules = pgTable("rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  repoId: integer("repo_id").references(() => repos.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  priority: integer("priority").default(0).notNull(), // lower runs first
  conditions: jsonb("conditions").notNull(),
  actions: jsonb("actions").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("rules_user_id_idx").on(t.userId),
}));

/**
 * Raw inbound webhook log — the system of record for "did we already
 * see this delivery". `deliveryId` is GitHub's X-GitHub-Delivery header,
 * unique per attempt GitHub makes; we rely on the unique index plus an
 * ON CONFLICT DO NOTHING insert to make processing idempotent even if
 * GitHub redelivers the same event (which it does on timeouts).
 */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  deliveryId: text("delivery_id").notNull(),
  eventType: text("event_type").notNull(), // "issues", "pull_request", "push"
  action: text("action"), // "opened", "closed", etc — null for push
  installationId: integer("installation_id").references(() => installations.id),
  repoId: integer("repo_id").references(() => repos.id),
  payload: jsonb("payload").notNull(),
  aiSummary: text("ai_summary"),
  aiSuggestedLabel: text("ai_suggested_label"),
  aiPriority: text("ai_priority"),
  status: text("status").default("received").notNull(), // received | processing | done | failed
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (t) => ({
  deliveryIdIdx: uniqueIndex("events_delivery_id_idx").on(t.deliveryId),
  repoIdIdx: index("events_repo_id_idx").on(t.repoId),
}));

/**
 * Every concrete action the bot attempted in response to an event
 * (label added, comment posted, Slack message sent). Tracks attempts
 * and last error so retries are visible, not silent.
 */
export const actionLogs = pgTable("action_logs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  ruleId: integer("rule_id").references(() => rules.id, { onDelete: "set null" }),
  actionType: text("action_type").notNull(), // "add_label" | "comment" | "slack_alert"
  target: text("target"), // label name, slack channel, etc.
  status: text("status").default("pending").notNull(), // pending | success | failed | retrying
  attemptCount: integer("attempt_count").default(0).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  eventIdIdx: index("action_logs_event_id_idx").on(t.eventId),
}));
