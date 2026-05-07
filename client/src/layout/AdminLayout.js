import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

const nav = [
  { to: "/pos", label: "POS" },
  { to: "/categories", label: "Categories" },
  { to: "/currencies", label: "Currencies" },
  { to: "/locations", label: "Locations" },
  { to: "/products", label: "Products" },
  { to: "/customers", label: "Customers" },
];

export function AdminLayout() {
  const { theme, toggleTheme } = useTheme();
  const nextLabel = theme === "dark" ? "Light" : "Dark";
  const ariaLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-brand-mark">DE</span>
          <div>
            <div className="admin-brand-title">DigitalEther</div>
            <div className="admin-brand-sub">Point of Sale</div>
          </div>
        </div>
        <nav className="admin-nav" aria-label="Main">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `admin-nav-link${isActive ? " admin-nav-link--active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <button
            type="button"
            className="btn btn-secondary theme-toggle"
            onClick={toggleTheme}
            aria-label={ariaLabel}
            title={ariaLabel}
          >
            <span className="theme-toggle-icon" aria-hidden>
              {theme === "dark" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
                    stroke="currentColor"
                    strokeWidth="1.75"
                  />
                  <path
                    d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 14.5A8.5 8.5 0 0 1 9.5 3 8.5 8.5 0 1 0 21 14.5Z"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="theme-toggle-label">{nextLabel}</span>
          </button>
        </nav>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
