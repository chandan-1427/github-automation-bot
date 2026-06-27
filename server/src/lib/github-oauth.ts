import { env } from "./env.js";
import { withRetry } from "./retry.js";

export function buildOauthAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.githubOauthClientId,
    redirect_uri: `${env.apiOrigin}/auth/github/callback`,
    scope: "read:user",
    state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeOauthCode(code: string): Promise<string> {
  return withRetry(async () => {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.githubOauthClientId,
        client_secret: env.githubOauthClientSecret,
        code,
        redirect_uri: `${env.apiOrigin}/auth/github/callback`,
      }),
    });
    if (!res.ok) throw new Error(`OAuth token exchange failed (${res.status})`);
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!data.access_token) throw new Error(`OAuth token exchange failed: ${data.error}`);
    return data.access_token;
  }, { attempts: 3, baseDelayMs: 400 });
}

export async function fetchGithubUser(accessToken: string) {
  return withRetry(async () => {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) throw new Error(`Failed to fetch GitHub user (${res.status})`);
    return (await res.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
    };
  }, { attempts: 3, baseDelayMs: 400 });
}
