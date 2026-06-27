import { env } from "./env.js";

/**
 * Sends a message to Slack via an Incoming Webhook URL. Accepts an
 * optional per-user webhook URL (set in their dashboard settings) so
 * each user's automation posts to their own Slack channel rather than
 * a single deployment-wide one. Falls back to the env-var default if
 * the user hasn't configured their own — useful for a quick demo/test
 * setup, but real multi-tenant use should rely on the per-user value.
 */
export async function sendSlackMessage(text: string, webhookUrlOverride?: string | null): Promise<void> {
  const url = webhookUrlOverride || env.slackWebhookUrl;
  if (!url) {
    console.log("[slack] no webhook URL configured (user or env), skipping notification:", text);
    return;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack notification failed (${res.status}): ${body}`);
  }
}