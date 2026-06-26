import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, getSessionUser } from "../lib/auth-middleware.js";
import { env } from "../lib/env.js";
import { listInstallationRepos } from "../lib/github-app.js";

export const installRoutes = new Hono();

/** Returns the URL the frontend should send the user to in order to install the GitHub App. */
installRoutes.get("/install/start", requireAuth, (c) => {
  const url = `https://github.com/apps/${env.githubAppSlug}/installations/new`;
  return c.json({ url });
});

/**
 * GitHub redirects here after the user finishes the installation flow,
 * with installation_id and setup_action in the query string. We record
 * the installation against the currently logged-in user.
 *
 * Note: this route must be reachable without re-checking GitHub OAuth
 * state, but it DOES require our own session — otherwise a logged-out
 * browser completing an install wouldn't have anyone to attach it to.
 */
installRoutes.get("/install/callback", async (c) => {
  // This route is reached by full browser navigation (GitHub redirects
  // here), not a fetch call, so on auth failure we redirect back to
  // sign-in rather than returning raw JSON the user would see as a
  // blank error page.
  const user = await getSessionUser(c);
  if (!user) {
    return c.redirect(`${env.webOrigin}/login?error=session_expired`);
  }

  const installationId = c.req.query("installation_id");
  if (!installationId) {
    return c.redirect(`${env.webOrigin}/dashboard?error=missing_installation_id`);
  }

  const ghInstallationId = parseInt(installationId, 10);

  const [existing] = await db
    .select()
    .from(schema.installations)
    .where(eq(schema.installations.installationId, ghInstallationId))
    .limit(1);

  let installationRowId: number;
  if (existing) {
    installationRowId = existing.id;
    // Re-installs/permission updates can hit this route again; keep the
    // owning user in sync rather than erroring on a duplicate.
    if (existing.userId !== user.id) {
      await db
        .update(schema.installations)
        .set({ userId: user.id })
        .where(eq(schema.installations.id, installationRowId));
    }
  } else {
    const repos = await listInstallationRepos(ghInstallationId).catch(() => []);
    const accountLogin = repos[0]?.owner?.login ?? "unknown";
    const [created] = await db
      .insert(schema.installations)
      .values({ installationId: ghInstallationId, accountLogin, userId: user.id })
      .returning();
    installationRowId = created.id;
  }

  return c.redirect(`${env.webOrigin}/dashboard?installed=1`);
});

/** Lists the user's installations and, for each, the repos available + whether they're enabled in our app. */
installRoutes.get("/install/repos", requireAuth, async (c) => {
  const user = c.get("user");

  const installs = await db
    .select()
    .from(schema.installations)
    .where(eq(schema.installations.userId, user.id));

  const result = [];
  for (const install of installs) {
    const ghRepos = await listInstallationRepos(install.installationId).catch(() => []);
    const enabledRows = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.installationId, install.id));
    const enabledByGithubId = new Map(enabledRows.map((r) => [r.githubRepoId, r]));

    result.push({
      installationId: install.id,
      accountLogin: install.accountLogin,
      repos: ghRepos.map((r: any) => ({
        githubRepoId: r.id,
        fullName: r.full_name,
        enabled: enabledByGithubId.has(r.id) ? enabledByGithubId.get(r.id)!.enabled : false,
        ourRepoId: enabledByGithubId.get(r.id)?.id ?? null,
      })),
    });
  }

  return c.json({ installations: result });
});

/** Enables bot automation on a specific repo (creates the repos row if needed). */
installRoutes.post("/install/repos/:githubRepoId/enable", requireAuth, async (c) => {
  const user = c.get("user");
  const githubRepoId = parseInt(c.req.param("githubRepoId")!, 10);
  const body = await c.req.json<{ installationId: number; fullName: string }>();

  // The installation must belong to the calling user — otherwise a
  // logged-in attacker could pass someone else's installationId and
  // wire our bot up to a repo they don't control.
  const [install] = await db
    .select()
    .from(schema.installations)
    .where(and(eq(schema.installations.id, body.installationId), eq(schema.installations.userId, user.id)))
    .limit(1);
  if (!install) {
    return c.json({ error: "Installation not found or not yours" }, 403);
  }

  const [existing] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.githubRepoId, githubRepoId))
    .limit(1);

  if (existing) {
    if (existing.ownerUserId !== user.id) {
      return c.json({ error: "Repo not found or not yours" }, 403);
    }
    await db.update(schema.repos).set({ enabled: true }).where(eq(schema.repos.id, existing.id));
  } else {
    await db.insert(schema.repos).values({
      githubRepoId,
      fullName: body.fullName,
      installationId: body.installationId,
      ownerUserId: user.id,
      enabled: true,
    });
  }
  return c.json({ ok: true });
});

installRoutes.post("/install/repos/:githubRepoId/disable", requireAuth, async (c) => {
  const user = c.get("user");
  const githubRepoId = parseInt(c.req.param("githubRepoId")!, 10);

  const [existing] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.githubRepoId, githubRepoId))
    .limit(1);
  if (!existing || existing.ownerUserId !== user.id) {
    return c.json({ error: "Repo not found or not yours" }, 403);
  }

  await db.update(schema.repos).set({ enabled: false }).where(eq(schema.repos.id, existing.id));
  return c.json({ ok: true });
});
