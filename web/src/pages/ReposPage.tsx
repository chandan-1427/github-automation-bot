import { useEffect, useState } from "react";
import { api, type InstallationWithRepos } from "../lib/api";

export default function ReposPage() {
  const [installations, setInstallations] = useState<InstallationWithRepos[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<number | null>(null);

  async function load() {
    try {
      const { installations } = await api.installRepos();
      setInstallations(installations);
      setError(null);
    } catch (err) {
      setError("Could not load repositories.");
      console.error(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleInstall() {
    const { url } = await api.installStart();
    window.location.href = url;
  }

  async function handleToggle(repo: { githubRepoId: number; enabled: boolean; fullName: string }, installationId: number) {
    setPendingToggle(repo.githubRepoId);
    try {
      if (repo.enabled) {
        await api.disableRepo(repo.githubRepoId);
      } else {
        await api.enableRepo(repo.githubRepoId, installationId, repo.fullName);
      }
      await load();
    } catch (err) {
      console.error(err);
    } finally {
      setPendingToggle(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 16, margin: 0 }}>Repositories</h2>
        <button className="btn btn-primary" onClick={handleInstall}>
          Connect a repository
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="card">
        <p className="card-title">How this works</p>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
          "Connect a repository" installs our GitHub App on the account you
          choose, which wires up webhooks automatically — no manual setup
          on GitHub's side. Then flip on the repos you want the bot to act on.
        </p>
      </div>

      {installations === null ? (
        <p className="text-dim">Loading…</p>
      ) : installations.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>No installations yet</h3>
            <p>Connect a repository to get started.</p>
          </div>
        </div>
      ) : (
        installations.map((install) => (
          <div className="card" key={install.installationId}>
            <p className="card-title">{install.accountLogin}</p>
            {install.repos.length === 0 ? (
              <p className="text-dim" style={{ fontSize: 13 }}>
                No repositories granted to this installation yet. Edit the
                installation on GitHub to grant repo access.
              </p>
            ) : (
              install.repos.map((repo) => (
                <div className="repo-row" key={repo.githubRepoId}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{repo.fullName}</span>
                  <button
                    className="toggle"
                    data-on={repo.enabled}
                    disabled={pendingToggle === repo.githubRepoId}
                    onClick={() => handleToggle(repo, install.installationId)}
                    aria-label={repo.enabled ? "Disable automation" : "Enable automation"}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}
