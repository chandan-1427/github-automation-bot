/**
 * Centralized environment access. We validate everything up front so the
 * app fails fast and loudly at boot (missing config) rather than failing
 * confusingly mid-request. Never log the values of secrets.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: parseInt(optional("PORT", "8080"), 10),

  // Where the frontend is deployed — used for CORS + OAuth redirect target
  webOrigin: required("WEB_ORIGIN"),
  // Where this server is deployed — used to build GitHub OAuth/App callback URLs
  apiOrigin: required("API_ORIGIN"),

  databaseUrl: required("DATABASE_URL"),

  sessionSecret: required("SESSION_SECRET"),

  // "Login with GitHub" OAuth App (identity only)
  githubOauthClientId: required("GITHUB_OAUTH_CLIENT_ID"),
  githubOauthClientSecret: required("GITHUB_OAUTH_CLIENT_SECRET"),

  // GitHub App (repo access + webhooks)
  githubAppId: required("GITHUB_APP_ID"),
  githubAppPrivateKey: required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
  githubAppWebhookSecret: required("GITHUB_APP_WEBHOOK_SECRET"),
  githubAppSlug: required("GITHUB_APP_SLUG"), // used to build the installation URL

  slackWebhookUrl: optional("SLACK_WEBHOOK_URL", ""),

  geminiApiKey: optional("GEMINI_API_KEY", ""),
  aiEnabled: optional("GEMINI_API_KEY", "") !== "",
};
