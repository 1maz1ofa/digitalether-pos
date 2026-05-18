import { useLayoutEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { COLOR_THEME_OPTIONS, useTheme } from "../context/ThemeContext";

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
  { to: "/stocktakes", label: "Stock takes" },
  { to: "/promises", label: "Promises" },
  { to: "/reserve-issue", label: "Reserve issue" },
  { to: "/movement", label: "Movement" },
  { to: "/movement-types", label: "Movement types" },
  { to: "/customers", label: "Customers" },
  { to: "/users", label: "Users" },
  { to: "/roles", label: "Roles" },
  { to: "/invoices", label: "Invoices" },
  { to: "/vat", label: "VAT" },
];

const CHECKOUT_COLOR_SELECT_ID = "admin-checkout-color-theme";

function CheckoutColorThemeFields({ colorTheme, setColorTheme }) {
  return (
    <>
      <label
        className="color-theme-menu-label"
        htmlFor={CHECKOUT_COLOR_SELECT_ID}
      >
        Checkout colors
      </label>
      <select
        id={CHECKOUT_COLOR_SELECT_ID}
        className="input color-theme-menu-select"
        value={colorTheme}
        onChange={(e) => setColorTheme(e.target.value)}
        aria-label="Checkout color theme"
        title="Colors for the sale type bar and Complete sale button on the POS screen"
      >
        {COLOR_THEME_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </>
  );
}

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
  const { theme, toggleTheme, colorTheme, setColorTheme } = useTheme();
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

  const colorThemeMenu = (
    <div className="color-theme-menu">
      <CheckoutColorThemeFields
        colorTheme={colorTheme}
        setColorTheme={setColorTheme}
      />
    </div>
  );

  return (
    <div className="admin-shell">
      <header
        className={`admin-header${navCollapsed ? " admin-header--pos-nav-collapsed" : ""}`}
      >
        <div className="admin-brand">
          <img
            className="admin-brand-logo"
            src={`${process.env.PUBLIC_URL || ""}/tv-sales-home-logo.png`}
            alt="TV Sales & Home"
            width={64}
            height={64}
            decoding="async"
          />
          <div>
            <div className="admin-brand-title">TV Sales &amp; Home</div>
            <div className="admin-brand-sub">Powered By Digital Ether</div>
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
              {colorThemeMenu}
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
              <CheckoutColorThemeFields
                colorTheme={colorTheme}
                setColorTheme={setColorTheme}
              />
              {themeToggle}
            </div>
          )}
        </div>
      </header>
      <main className={isPosRoute ? "admin-main admin-main--pos" : "admin-main"}>
        <Outlet />
      </main>
    </div>
  );
}
