import { Link } from "react-router-dom";

/** Renders a router link when allowed, otherwise non-interactive text. */
export function PermissionLink({ canAccess, to, className, children, title }) {
  if (!canAccess) {
    return (
      <span className={className} title={title || "No permission"} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link to={to} className={className} title={title}>
      {children}
    </Link>
  );
}
