import jwt from "jsonwebtoken";
import { env } from "./env.js";

/**
 * Signs a short-lived JWT as the GitHub App itself (not as any
 * installation). This JWT is only used to request installation access
 * tokens — GitHub requires app-level JWT auth for that one endpoint.
 * Kept short (9 minutes, GitHub's max is 10) to limit the blast radius
 * if it ever leaked.
 */
function signAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60, // allow for clock drift
      exp: now + 9 * 60,
      iss: env.githubAppId,
    },
    env.githubAppPrivateKey,
    { algorithm: "RS256" }
  );
}

type CachedToken = { token: string; expiresAt: number };
const installationTokenCache = new Map<number, CachedToken>();

/**
 * Exchanges the app JWT for a real, scoped installation access token.
 * GitHub installation tokens last 1 hour; we cache and reuse until ~5
 * minutes before expiry so we're not re-authenticating on every webhook.
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = installationTokenCache.get(installationId);
  const now = Date.now();
  if (cached && cached.expiresAt - 5 * 60 * 1000 > now) {
    return cached.token;
  }

  const appJwt = signAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get installation token (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  installationTokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

/** Lists repositories accessible to a given installation. */
export async function listInstallationRepos(installationId: number) {
  const token = await getInstallationToken(installationId);
  const res = await fetch("https://api.github.com/installation/repositories", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to list installation repos (${res.status})`);
  }
  const data = (await res.json()) as { repositories: any[] };
  return data.repositories;
}

/** Adds a label to an issue or pull request (PRs are issues under the hood). */
export async function addLabel(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
  label: string
) {
  const token = await getInstallationToken(installationId);
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ labels: [label] }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to add label (${res.status}): ${body}`);
  }
}

/** Posts a comment on an issue or pull request. */
export async function postComment(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
) {
  const token = await getInstallationToken(installationId);
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to post comment (${res.status}): ${text}`);
  }
}
