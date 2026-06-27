import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

export default function SettingsPage() {
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setSlackWebhookUrl(s.slackWebhookUrl ?? ""))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateSettings(slackWebhookUrl.trim() || null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 16, margin: "0 0 16px" }}>Settings</h2>

      <div className="card">
        <p className="card-title">Slack notifications</p>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
          Paste your own Slack Incoming Webhook URL so rule alerts post to
          your channel. If you leave this blank, alerts go to this
          deployment's default Slack channel (if one is configured) — not
          your own.
        </p>
        <div className="field">
          <label>Incoming Webhook URL</label>
          <input
            type="text"
            value={slackWebhookUrl}
            placeholder="https://hooks.slack.com/services/..."
            onChange={(e) => setSlackWebhookUrl(e.target.value)}
            disabled={loading}
          />
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        {saved && <p style={{ color: "var(--accent)", fontSize: 13 }}>Saved.</p>}
        <button className="btn btn-primary" onClick={handleSave} disabled={loading || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <p className="text-dim" style={{ fontSize: 12, marginTop: 12 }}>
          Don't have one yet?{" "}
          <a
            href="https://api.slack.com/messaging/webhooks"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
          >
            Create an Incoming Webhook
          </a>{" "}
          in your Slack workspace, then paste the URL it gives you here.
        </p>
      </div>
    </div>
  );
}