import { useEffect, useState } from "react";
import { api, type Rule } from "../lib/api";
import RuleEditor from "../components/RuleEditor";

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { rules } = await api.rules();
      setRules(rules);
      setError(null);
    } catch (err) {
      setError("Could not load rules.");
      console.error(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(payload: { name: string; conditions: Rule["conditions"]; actions: Rule["actions"] }) {
    await api.createRule(payload);
    setCreating(false);
    await load();
  }

  async function handleUpdate(id: number, payload: { name: string; conditions: Rule["conditions"]; actions: Rule["actions"] }) {
    await api.updateRule(id, payload);
    setEditingId(null);
    await load();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this rule?")) return;
    await api.deleteRule(id);
    await load();
  }

  async function handleToggleEnabled(rule: Rule) {
    await api.updateRule(rule.id, { enabled: !rule.enabled });
    await load();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 16, margin: 0 }}>Rules</h2>
        {!creating && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + New rule
          </button>
        )}
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          {error}
        </div>
      )}

      {creating && (
        <RuleEditor onSave={handleCreate} onCancel={() => setCreating(false)} />
      )}

      {rules === null ? (
        <p className="text-dim">Loading…</p>
      ) : rules.length === 0 && !creating ? (
        <div className="card">
          <div className="empty-state">
            <h3>No rules yet</h3>
            <p>
              Rules decide what the bot does. For example: "issues whose
              title contains bug → add the bug label and alert Slack."
            </p>
          </div>
        </div>
      ) : (
        rules.map((rule) =>
          editingId === rule.id ? (
            <RuleEditor
              key={rule.id}
              rule={rule}
              onSave={(payload) => handleUpdate(rule.id, payload)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="rule-card" key={rule.id} style={{ opacity: rule.enabled ? 1 : 0.5 }}>
              <div className="rule-header">
                <span className="rule-name">{rule.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => handleToggleEnabled(rule)}>
                    {rule.enabled ? "Disable" : "Enable"}
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditingId(rule.id)}>
                    Edit
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(rule.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <p className="text-dim" style={{ fontSize: 13, margin: "4px 0" }}>
                When <strong>{rule.conditions.eventTypes.join(", ")}</strong> matches{" "}
                {rule.conditions.matches.map((m, i) => (
                  <span key={i}>
                    {i > 0 ? " and " : ""}
                    <code>{m.field}</code> {m.type} "<code>{m.value}</code>"
                  </span>
                ))}
                {rule.conditions.matches.length === 0 && "any event of that type"}
              </p>
              <p className="text-dim" style={{ fontSize: 13, margin: "4px 0" }}>
                Then:{" "}
                {[
                  rule.actions.addLabel && `add label "${rule.actions.addLabel}"`,
                  rule.actions.comment && "post a comment",
                  rule.actions.slackAlert && "alert Slack",
                ]
                  .filter(Boolean)
                  .join(", ") || "(no actions configured)"}
              </p>
            </div>
          )
        )
      )}
    </div>
  );
}
