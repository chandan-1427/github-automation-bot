import { db, schema } from "../db/client.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { ruleMatches, renderTemplate, type RuleConditions, type RuleActions, type RuleEvent } from "./rules-engine.js";
import { addLabel, postComment } from "./github-app.js";
import { sendSlackMessage } from "./slack.js";
import { withRetry } from "./retry.js";
import { triageWithGemini } from "./gemini.js";

type NormalizedEvent = RuleEvent & {
  owner: string;
  repo: string;
  issueNumber: number | null;
};

/** Pulls the fields the rules engine and AI step care about out of GitHub's raw payload shapes. */
function normalizeEvent(eventType: string, payload: any): NormalizedEvent | null {
  const [owner, repo] = (payload.repository?.full_name ?? "/").split("/");

  if (eventType === "issues") {
    return {
      eventType,
      title: payload.issue?.title ?? "",
      body: payload.issue?.body ?? "",
      author: payload.issue?.user?.login ?? "",
      labels: (payload.issue?.labels ?? []).map((l: any) => l.name),
      owner,
      repo,
      issueNumber: payload.issue?.number ?? null,
    };
  }
  if (eventType === "pull_request") {
    return {
      eventType,
      title: payload.pull_request?.title ?? "",
      body: payload.pull_request?.body ?? "",
      author: payload.pull_request?.user?.login ?? "",
      labels: (payload.pull_request?.labels ?? []).map((l: any) => l.name),
      owner,
      repo,
      issueNumber: payload.pull_request?.number ?? null,
    };
  }
  if (eventType === "push") {
    return {
      eventType,
      title: payload.head_commit?.message ?? "",
      body: "",
      author: payload.pusher?.login ?? payload.pusher?.name ?? "",
      labels: [],
      owner,
      repo,
      issueNumber: null,
    };
  }
  return null;
}

/**
 * Records one action attempt and runs it with retries. Always writes a
 * row up front (status "pending") so even a process crash mid-action
 * leaves visible evidence in the dashboard rather than disappearing
 * silently — then updates status to success/failed once we know.
 */
async function runAction(
  eventId: number,
  ruleId: number | null,
  actionType: string,
  target: string | null,
  fn: () => Promise<void>
) {
  const [log] = await db
    .insert(schema.actionLogs)
    .values({ eventId, ruleId, actionType, target, status: "pending" })
    .returning();

  try {
    await withRetry(fn, { attempts: 3, baseDelayMs: 500 });
    await db
      .update(schema.actionLogs)
      .set({ status: "success", updatedAt: new Date() })
      .where(eq(schema.actionLogs.id, log.id));
  } catch (err: any) {
    await db
      .update(schema.actionLogs)
      .set({
        status: "failed",
        attemptCount: 3,
        lastError: String(err?.message ?? err).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(schema.actionLogs.id, log.id));
    console.error(`[action] ${actionType} failed for event ${eventId}:`, err);
  }
}

// installationId on repos is our internal serial id (schema.installations.id);
// GitHub API calls need the *GitHub* installation id. We resolve it once per
// process call via a tiny in-process cache to avoid a DB round trip per action.
const installationGithubIdCache = new Map<number, number>();

async function getInstallationGithubId(internalInstallationId: number): Promise<number> {
  const cached = installationGithubIdCache.get(internalInstallationId);
  if (cached) return cached;
  const [row] = await db
    .select()
    .from(schema.installations)
    .where(eq(schema.installations.id, internalInstallationId))
    .limit(1);
  if (!row) throw new Error(`Installation ${internalInstallationId} not found`);
  installationGithubIdCache.set(internalInstallationId, row.installationId);
  return row.installationId;
}

/**
 * Main entry point, called after a webhook has been verified and
 * idempotently recorded. Looks up matching rules for the repo's owner,
 * runs the optional AI triage step, evaluates rules in priority order,
 * and executes whichever actions matched — each isolated so one
 * failing action (e.g. Slack down) doesn't block the others (e.g.
 * GitHub label still gets applied).
 */
export async function processEvent(eventRowId: number) {
  const [eventRow] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventRowId))
    .limit(1);
  if (!eventRow) return;

  await db
    .update(schema.events)
    .set({ status: "processing" })
    .where(eq(schema.events.id, eventRowId));

  try {
    const normalized = normalizeEvent(eventRow.eventType, eventRow.payload);
    if (!normalized || !eventRow.repoId) {
      await db.update(schema.events).set({ status: "done" }).where(eq(schema.events.id, eventRowId));
      return;
    }

    const [repoRow] = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, eventRow.repoId))
      .limit(1);
    if (!repoRow || !repoRow.enabled) {
      await db.update(schema.events).set({ status: "done" }).where(eq(schema.events.id, eventRowId));
      return;
    }

    const installationGithubId = await getInstallationGithubId(repoRow.installationId);

    // Optional AI triage — runs once per event, independent of rules,
    // so the dashboard always shows it for opened issues/PRs even if
    // no rule happens to match.
    if ((eventRow.eventType === "issues" || eventRow.eventType === "pull_request") && eventRow.action === "opened") {
      try {
        const triage = await triageWithGemini(normalized.title, normalized.body);
        if (triage) {
          await db
            .update(schema.events)
            .set({
              aiSummary: triage.summary,
              aiSuggestedLabel: triage.suggestedLabel,
              aiPriority: triage.priority,
            })
            .where(eq(schema.events.id, eventRowId));
        }
      } catch (err) {
        console.warn("[ai] triage failed, continuing without it:", err);
      }
    }

    const rules = await db
      .select()
      .from(schema.rules)
      .where(
        and(
          eq(schema.rules.userId, repoRow.ownerUserId),
          eq(schema.rules.enabled, true),
          or(isNull(schema.rules.repoId), eq(schema.rules.repoId, repoRow.id))
        )
      )
      .orderBy(schema.rules.priority);

    for (const rule of rules) {
      const conditions = rule.conditions as RuleConditions;
      if (!ruleMatches(conditions, normalized)) continue;

      const actions = rule.actions as RuleActions;

      if (actions.addLabel && normalized.issueNumber) {
        await runAction(eventRowId, rule.id, "add_label", actions.addLabel, () =>
          addLabel(
            installationGithubId,
            normalized.owner,
            normalized.repo,
            normalized.issueNumber!,
            actions.addLabel!
          )
        );
      }

      if (actions.comment && normalized.issueNumber) {
        const rendered = renderTemplate(actions.comment, normalized);
        await runAction(eventRowId, rule.id, "comment", null, () =>
          postComment(installationGithubId, normalized.owner, normalized.repo, normalized.issueNumber!, rendered)
        );
      }

      if (actions.slackAlert) {
        const text = `:robot_face: *${rule.name}* matched on \`${normalized.owner}/${normalized.repo}\`\n*${normalized.title}* by ${normalized.author}`;
        await runAction(eventRowId, rule.id, "slack_alert", "slack", () => sendSlackMessage(text));
      }
    }

    await db.update(schema.events).set({ status: "done" }).where(eq(schema.events.id, eventRowId));
  } catch (err) {
    console.error(`[process] event ${eventRowId} failed:`, err);
    await db.update(schema.events).set({ status: "failed" }).where(eq(schema.events.id, eventRowId));
  }
}
