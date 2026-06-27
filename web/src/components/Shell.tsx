import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, refresh } = useAuth();
  const location = useLocation();

  async function handleLogout() {
    await api.logout();
    await refresh();
    window.location.href = "/login";
  }

  const navItem = (to: string, label: string) => (
    <Link
      to={to}
      style={{
        textDecoration: "none",
        color: location.pathname === to ? "var(--accent)" : "var(--text-dim)",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {label}
    </Link>
  );

  return (
    <div className="app-shell" style={{ flexDirection: "column" }}>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div className="brand">
            <span className="brand-dot" />
            repo-bot
          </div>
          <nav style={{ display: "flex", gap: 20 }}>
            {navItem("/dashboard", "Activity")}
            {navItem("/rules", "Rules")}
            {navItem("/repos", "Repositories")}
            {navItem("/settings", "Settings")}
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {user?.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt={user.login}
              width={24}
              height={24}
              style={{ borderRadius: "50%" }}
            />
          )}
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{user?.login}</span>
          <button className="btn btn-sm" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>
      <div className="main-content">{children}</div>
    </div>
  );
}
