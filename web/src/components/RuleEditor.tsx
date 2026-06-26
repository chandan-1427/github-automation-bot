import { useState } from "react";
import type { Rule } from "../lib/api";

type MatchDraft = { field: string; type: string; value: string };

type Draft = {
  name: string;
  eventTypes: string[];
  matches: MatchDraft[];
  addLabel: string;
  comment: string;
  slackAlert: boolean;
};

function ruleToDraft(rule?: Rule): Draft {
  if (!rule) {
    return {
      name: "",
      eventTypes: ["issues"],
      matches: [{ field: "title", type: "contains", value: "" }],
      addLabel: "",
      comment: "",
      slackAlert: true,
    };
  }
  return {
    name: rule.name,
    eventTypes: rule.conditions.eventTypes,
    matches: rule.conditions.matches.length > 0 ? rule.conditions.matches : [{ field: "title", type: "contains", value: "" }],
    addLabel: rule.actions.addLabel ?? "",
    comment: rule.actions.comment ?? "",
    slackAlert: rule.actions.slackAlert ?? false,
  };
}

const EVENT_TYPE_OPTIONS = ["issues", "pull_request", "push"];
const FIELD_OPTIONS = ["title", "body", "author", "label"];
const MATCH_TYPE_OPTIONS = ["contains", "equals", "regex"];

export default function RuleEditor({
  rule,
  onSave,
  onCancel,
}: {
  rule?: Rule;
  onSave: (payload: { name: string; conditions: Rule["conditions"]; actions: Rule["actions"] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(ruleToDraft(rule));
  const [saving, setSaving] = useState(false);

  function updateMatch(index: number, patch: Partial<MatchDraft>) {
    setDraft((d) => ({
      ...d,
      matches: d.matches.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  }

  function addMatch() {
    setDraft((d) => ({ ...d, matches: [...d.matches, { field: "title", type: "contains", value: "" }] }));
  }

  function removeMatch(index: number) {
    setDraft((d) => ({ ...d, matches: d.matches.filter((_, i) => i !== index) }));
  }

  function toggleEventType(type: string) {
    setDraft((d) => ({
      ...d,
      eventTypes: d.eventTypes.includes(type) ? d.eventTypes.filter((t) => t !== type) : [...d.eventTypes, type],
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        name: draft.name,
        conditions: {
          eventTypes: draft.eventTypes,
          matches: draft.matches.filter((m) => m.value.trim() !== ""),
        },
        actions: {
          ...(draft.addLabel.trim() ? { addLabel: draft.addLabel.trim() } : {}),
          ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
          slackAlert: draft.slackAlert,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  const canSave = draft.name.trim() !== "" && draft.eventTypes.length > 0;

  return (
    <div className="rule-card">
      <div className="field">
        <label>Rule name</label>
        <input
          type="text"
          value={draft.name}
          placeholder="e.g. Flag bugs"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      <div className="field">
        <label>Applies to</label>
        <div style={{ display: "flex", gap: 14 }}>
          {EVENT_TYPE_OPTIONS.map((type) => (
            <label key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text)" }}>
              <input type="checkbox" checked={draft.eventTypes.includes(type)} onChange={() => toggleEventType(type)} />
              {type}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Match conditions (all must match)</label>
        {draft.matches.map((m, i) => (
          <div className="match-row" key={i}>
            <select value={m.field} onChange={(e) => updateMatch(i, { field: e.target.value })}>
              {FIELD_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select value={m.type} onChange={(e) => updateMatch(i, { type: e.target.value })}>
              {MATCH_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={m.value}
              placeholder="value to match"
              onChange={(e) => updateMatch(i, { value: e.target.value })}
            />
            <button className="btn btn-sm" onClick={() => removeMatch(i)} aria-label="Remove condition">
              ✕
            </button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={addMatch}>
          + Add condition
        </button>
      </div>

      <div className="field">
        <label>Add label</label>
        <input
          type="text"
          value={draft.addLabel}
          placeholder="e.g. bug (leave blank to skip)"
          onChange={(e) => setDraft((d) => ({ ...d, addLabel: e.target.value }))}
        />
      </div>

      <div className="field">
        <label>Post comment</label>
        <textarea
          rows={2}
          value={draft.comment}
          placeholder="Use {{title}} and {{author}} as placeholders. Leave blank to skip."
          onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
        />
      </div>

      <div className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.slackAlert}
          onChange={(e) => setDraft((d) => ({ ...d, slackAlert: e.target.checked }))}
        />
        <label style={{ margin: 0 }}>Send a Slack alert</label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" disabled={!canSave || saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save rule"}
        </button>
        <button className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
