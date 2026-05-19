import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canAccessPath, firstAllowedPath } from "../utils/menuAccess";

function resolvePostLoginPath(requestedPath, menuAccess) {
  const requested = requestedPath || "/pos";
  if (canAccessPath(requested, menuAccess)) return requested;
  return firstAllowedPath(menuAccess) || "/pos";
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedFrom = location.state?.from;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    const target = resolvePostLoginPath(requestedFrom, user.menu_access);
    return <Navigate to={target} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const loggedIn = await login(email, password);
      const target = resolvePostLoginPath(requestedFrom, loggedIn?.menu_access);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message || "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <header className="login-header">
          <img
            className="login-logo"
            src={`${process.env.PUBLIC_URL || ""}/tv-sales-home-logo.png`}
            alt="TV Sales & Home"
            width={72}
            height={72}
            decoding="async"
          />
          <h1>Sign in</h1>
          <p className="page-lead">Use your account to access TV Sales &amp; Home POS.</p>
        </header>

        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting || loading}
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={submitting || loading}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={submitting || loading}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
