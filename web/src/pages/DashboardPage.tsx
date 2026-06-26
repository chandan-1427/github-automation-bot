import { useEffect, useState, useCallback } from "react";
import { api, type EventRow } from "../lib/api";

const STATUS_PILL_CLASS: Record<string, string> = {
  success: "pill-success",
  done: "pill-success",
  failed: "pill-failed",
  pending: "pill-pending",
  processing: "pill-processing",
  received: "pill-received",
  retrying: "pill-pending",
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DashboardPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { events } = await api.events(50);
      setEvents(events);
      setError(null);
    } catch (err) {
      setError("Could not load activity. Retrying shortly.");
      console.error(err);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll rather than websockets — simplest reliable way to get a
    // "live" feel for a log viewer without adding a socket server.
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 16, margin: 0 }}>Activity</h2>
        <span className="text-dim" style={{ fontSize: 12 }}>refreshes every 8s</span>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="card">
        {events === null ? (
          <p className="text-dim">Loading…</p>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <h3>No events yet</h3>
            <p>
              Once you connect a repository and something happens there — an
              issue opens, a PR is filed — it'll show up here.
            </p>
          </div>
        ) : (
          events.map((e) => (
            <div className="event-row" key={e.id}>
              <div className="event-head">
                <span className={`pill ${STATUS_PILL_CLASS[e.status] ?? "pill-pending"}`}>{e.status}</span>
                <span className="event-repo">{e.repoFullName}</span>
                <span className="event-title">
                  {e.eventType}
                  {e.action ? `.${e.action}` : ""}
                  {e.title ? ` — ${e.title}` : ""}
                </span>
              </div>
              <div className="event-meta">{formatRelativeTime(e.receivedAt)}</div>

              {e.aiSummary && (
                <div className="ai-box">
                  <strong>AI triage:</strong> {e.aiSummary}
                  {e.aiSuggestedLabel && <> · suggested label: <code>{e.aiSuggestedLabel}</code></>}
                  {e.aiPriority && <> · priority: {e.aiPriority}</>}
                </div>
              )}

              {e.actions.length > 0 && (
                <div className="action-list">
                  {e.actions.map((a) => (
                    <span key={a.id} className={`action-chip ${a.status === "failed" ? "" : ""}`}>
                      <span
                        style={{
                          color:
                            a.status === "success"
                              ? "var(--accent)"
                              : a.status === "failed"
                                ? "var(--danger)"
                                : "var(--warn)",
                        }}
                      >
                        ●
                      </span>
                      {a.actionType}
                      {a.target ? `: ${a.target}` : ""}
                      {a.status === "failed" && a.lastError ? ` (${a.lastError.slice(0, 60)})` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
