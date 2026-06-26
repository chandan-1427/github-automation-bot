import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Verifies a GitHub webhook's X-Hub-Signature-256 header against the raw
 * request body using the app's webhook secret. This is what stops anyone
 * who isn't GitHub from POSTing fake events at our endpoint — without it,
 * an attacker could forge an "issue opened" event and trigger our bot to
 * post comments / labels / Slack alerts on a repo they don't control.
 *
 * Uses a constant-time comparison (timingSafeEqual) so an attacker can't
 * use response-time differences to guess the signature byte by byte.
 */
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);

  // timingSafeEqual throws if lengths differ, so guard that first.
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

/** Generates an opaque, unguessable session id for the session cookie. */
export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** Generates an opaque state value for the OAuth CSRF check. */
export function generateOAuthState(): string {
  return randomBytes(24).toString("base64url");
}
