import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

export const SESSION_COOKIE_NAME = "gh_bot_session";

export type AuthedUser = {
  id: number;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthedUser;
  }
}

/**
 * Loads the session from the cookie, checks it hasn't expired, and
 * attaches the user to context. Expired or unknown sessions are treated
 * the same as "not logged in" rather than erroring, so a stale cookie
 * doesn't break the app — it just sends the user back to sign in.
 */
/**
 * Loads the current user from a request's session cookie, or null if
 * there isn't a valid one. Shared by requireAuth (JSON API routes) and
 * any route that needs different failure handling, like a redirect
 * instead of a 401 (e.g. /install/callback, reached by full browser
 * navigation rather than fetch).
 */
export async function getSessionUser(c: Context): Promise<AuthedUser | null> {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionId) return null;

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!user) return null;

  return {
    id: user.id,
    githubId: user.githubId,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export async function requireAuth(c: Context, next: Next) {
  const user = await getSessionUser(c);
  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  c.set("user", user);
  await next();
}
