import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";
import { buildOauthAuthorizeUrl, exchangeOauthCode, fetchGithubUser } from "../lib/github-oauth.js";
import { generateOAuthState, generateSessionId } from "../lib/crypto.js";
import { env } from "../lib/env.js";
import { SESSION_COOKIE_NAME, requireAuth } from "../lib/auth-middleware.js";

export const authRoutes = new Hono();

const OAUTH_STATE_COOKIE = "gh_bot_oauth_state";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

authRoutes.get("/auth/github/login", (c) => {
  const state = generateOAuthState();
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "Lax",
    maxAge: 600, // 10 minutes, just long enough to complete the redirect dance
    path: "/",
  });
  return c.redirect(buildOauthAuthorizeUrl(state));
});

authRoutes.get("/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, OAUTH_STATE_COOKIE);

  // CSRF protection: the state we get back must match the one we set
  // before redirecting to GitHub. Without this, an attacker could trick
  // a victim into completing an OAuth flow initiated by the attacker,
  // linking the attacker's GitHub identity to the victim's session.
  if (!code || !state || !cookieState || state !== cookieState) {
    return c.redirect(`${env.webOrigin}/login?error=invalid_state`);
  }
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });

  try {
    const accessToken = await exchangeOauthCode(code);
    const ghUser = await fetchGithubUser(accessToken);

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.githubId, ghUser.id))
      .limit(1);

    let userId: number;
    if (existing) {
      userId = existing.id;
      await db
        .update(schema.users)
        .set({ login: ghUser.login, name: ghUser.name, avatarUrl: ghUser.avatar_url })
        .where(eq(schema.users.id, userId));
    } else {
      const [created] = await db
        .insert(schema.users)
        .values({
          githubId: ghUser.id,
          login: ghUser.login,
          name: ghUser.name,
          avatarUrl: ghUser.avatar_url,
        })
        .returning();
      userId = created.id;
    }

    const sessionId = generateSessionId();
    await db.insert(schema.sessions).values({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    setCookie(c, SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "Lax",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
    });

    return c.redirect(`${env.webOrigin}/dashboard`);
  } catch (err) {
    console.error("[auth] OAuth callback failed:", err);
    return c.redirect(`${env.webOrigin}/login?error=oauth_failed`);
  }
});

authRoutes.post("/auth/logout", requireAuth, async (c) => {
  // We don't strictly need requireAuth here, but it gives us a clean
  // 401 for an already-logged-out client instead of silently no-oping.
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/auth/me", requireAuth, (c) => {
  return c.json({ user: c.get("user") });
});
