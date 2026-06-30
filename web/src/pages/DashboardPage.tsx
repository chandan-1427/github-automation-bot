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

const EVENT_TYPE_OPTIONS = [
  { label: "Issues", value: "issues" },
  { label: "Pull Requests", value: "pull_request" },
  { label: "Push", value: "push" },
];

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
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const load = useCallback(async (types: string[]) => {
    try {
      const { events } = await api.events(50, types);
      setEvents(events);
      setError(null);
    } catch (err) {
      setError("Could not load activity. Retrying shortly.");
      console.error(err);
    }
  }, []);

  // Re-fetch immediately when filter changes, then restart the poll
  // interval so it also uses the new filter going forward.
  useEffect(() => {
    load(selectedTypes);
    const interval = setInterval(() => load(selectedTypes), 8000);
    return () => clearInterval(interval);
  }, [load, selectedTypes]);

  function toggleType(value: string) {
    setSelectedTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    );
  }

  function clearFilter() {
    setSelectedTypes([]);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 16, margin: 0 }}>Activity</h2>
        <span className="text-dim" style={{ fontSize: 12 }}>refreshes every 8s</span>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {EVENT_TYPE_OPTIONS.map((opt) => {
          const active = selectedTypes.includes(opt.value);
          return (
            <button
              key={opt.value}
              className="btn btn-sm"
              onClick={() => toggleType(opt.value)}
              style={{
                borderColor: active ? "var(--accent)" : "var(--border)",
                color: active ? "var(--accent)" : "var(--text-dim)",
                background: active ? "rgba(63,185,80,0.08)" : "transparent",
                transition: "all 0.15s ease",
              }}
            >
              {opt.label}
            </button>
          );
        })}
        {selectedTypes.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={clearFilter}
            style={{ color: "var(--text-dim)", borderColor: "var(--border)" }}
          >
            Clear
          </button>
        )}
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
            <h3>{selectedTypes.length > 0 ? "No matching events" : "No events yet"}</h3>
            <p>
              {selectedTypes.length > 0
                ? `No ${selectedTypes.join(" or ")} events found. Try a different filter or clear it.`
                : "Once you connect a repository and something happens there — an issue opens, a PR is filed — it'll show up here."}
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
                    <span key={a.id} className="action-chip">
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