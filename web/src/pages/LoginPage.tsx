import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [loading, user, navigate]);

  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");

  return (
    <div className="login-screen">
      <div className="brand" style={{ fontSize: 20 }}>
        <span className="brand-dot" />
        repo-bot
      </div>
      <h1>Automate what happens on your repos</h1>
      <p className="text-dim" style={{ maxWidth: 420, margin: "-8px 0 0" }}>
        Sign in, connect a repository, and define rules for labeling issues,
        commenting, and alerting your team in Slack — automatically.
      </p>
      {error && (
        <p style={{ color: "var(--danger)", fontSize: 13 }}>
          Sign-in failed ({error}). Please try again.
        </p>
      )}
      <a href={api.loginUrl()} className="btn btn-primary" style={{ textDecoration: "none" }}>
        Sign in with GitHub
      </a>
    </div>
  );
}
