import { useLayoutEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseNavIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const nav = [
  { to: "/pos", label: "POS" },
  { to: "/categories", label: "Categories" },
  { to: "/currencies", label: "Currencies" },
  { to: "/locations", label: "Locations" },
  { to: "/products", label: "Products" },
  { to: "/inventory", label: "Inventory" },
  { to: "/promises", label: "Promises" },
  { to: "/reserve-issue", label: "Reserve issue" },
  { to: "/movement", label: "Movement" },
  { to: "/movement-types", label: "Movement types" },
  { to: "/customers", label: "Customers" },
  { to: "/invoices", label: "Invoices" },
  { to: "/vat", label: "VAT" },
];

function ThemeToggleButton({ theme, toggleTheme, nextLabel, ariaLabel }) {
  return (
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
  );
}

export function AdminLayout() {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const nextLabel = theme === "dark" ? "Light" : "Dark";
  const ariaLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  const isPosRoute = location.pathname === "/pos";
  const [posNavExpanded, setPosNavExpanded] = useState(
    () => location.pathname !== "/pos"
  );

  useLayoutEffect(() => {
    if (location.pathname === "/pos") {
      setPosNavExpanded(false);
    } else {
      setPosNavExpanded(true);
    }
  }, [location.pathname]);

  const navCollapsed = isPosRoute && !posNavExpanded;
  const themeToggle = (
    <ThemeToggleButton
      theme={theme}
      toggleTheme={toggleTheme}
      nextLabel={nextLabel}
      ariaLabel={ariaLabel}
    />
  );

  return (
    <div className="admin-shell">
      <header
        className={`admin-header${navCollapsed ? " admin-header--pos-nav-collapsed" : ""}`}
      >
        <div className="admin-brand">
          <span className="admin-brand-mark">DE</span>
          <div>
            <div className="admin-brand-title">DigitalEther</div>
            <div className="admin-brand-sub">Point of Sale</div>
          </div>
        </div>
        <div className="admin-header-right">
          {!navCollapsed ? (
            <nav
              id="admin-main-nav"
              className="admin-nav"
              aria-label="Main"
            >
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
              {isPosRoute ? (
                <button
                  type="button"
                  className="btn btn-secondary admin-nav-collapse-btn"
                  onClick={() => setPosNavExpanded(false)}
                  aria-expanded
                  aria-controls="admin-main-nav"
                  aria-label="Hide navigation menu"
                  title="Hide menu"
                >
                  <CloseNavIcon />
                </button>
              ) : null}
              {themeToggle}
            </nav>
          ) : (
            <div className="admin-header-collapsed-nav">
              <button
                type="button"
                className="btn btn-secondary admin-nav-expand-btn"
                onClick={() => setPosNavExpanded(true)}
                aria-expanded={false}
                aria-label="Open navigation menu"
                title="Menu"
              >
                <MenuIcon />
              </button>
              {themeToggle}
            </div>
          )}
        </div>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
