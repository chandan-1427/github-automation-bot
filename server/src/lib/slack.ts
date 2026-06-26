import { env } from "./env.js";

/**
 * Sends a message to Slack via an Incoming Webhook URL. This is the
 * simplest free Slack integration — no bot token, no OAuth, just a
 * per-channel URL generated from the Slack App config. If no webhook
 * URL is configured we no-op (lets the rest of the app run without
 * Slack set up yet, e.g. during local dev).
 */
export async function sendSlackMessage(text: string): Promise<void> {
  if (!env.slackWebhookUrl) {
    console.log("[slack] SLACK_WEBHOOK_URL not set, skipping notification:", text);
    return;
  }

  const res = await fetch(env.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack notification failed (${res.status}): ${body}`);
  }
}
