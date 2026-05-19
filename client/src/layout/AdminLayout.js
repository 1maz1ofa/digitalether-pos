import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { COLOR_THEME_OPTIONS, useTheme } from "../context/ThemeContext";

const nav = [
  { to: "/pos", label: "POS" },
  {
    label: "Configurations",
    children: [
      { to: "/vat", label: "VAT" },
      { to: "/movement-types", label: "Movement types" },
      { to: "/currencies", label: "Currencies" },
      { to: "/categories", label: "Categories" },
      { to: "/locations", label: "Locations" },
    ],
  },
  {
    label: "User management",
    children: [
      { to: "/users", label: "Users" },
      { to: "/roles", label: "Roles" },
    ],
  },
  {
    label: "Product Management",
    children: [
      { to: "/products", label: "Products" },
      { to: "/inventory", label: "Inventory" },
      { to: "/stocktakes", label: "Stock Take" },
      { to: "/movement", label: "Movement" },
      { to: "/promises", label: "Promises" },
      { to: "/reserve-issue", label: "Reserve Issues" },
    ],
  },
  {
    label: "Sales Management",
    children: [
      { to: "/customers", label: "Customers" },
      { to: "/invoices", label: "Invoices" },
    ],
  },
];

function navItemIsActive(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function AdminNavGroup({ label, items, pathname }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isActive = items.some((item) => navItemIsActive(pathname, item.to));

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div
      className={`admin-nav-group${isActive ? " admin-nav-group--active" : ""}${open ? " admin-nav-group--open" : ""}`}
      ref={ref}
    >
      <button
        type="button"
        className="admin-nav-link admin-nav-group-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="admin-nav-group-chevron" aria-hidden />
      </button>
      {open ? (
        <div className="admin-nav-group-menu" role="menu">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              className={({ isActive: linkActive }) =>
                `admin-nav-group-item${linkActive ? " admin-nav-group-item--active" : ""}`
              }
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CheckoutColorThemeFields({ colorTheme, setColorTheme }) {
  return (
    <select
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
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme, colorTheme, setColorTheme } = useTheme();
  const nextLabel = theme === "dark" ? "Light" : "Dark";
  const ariaLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  const isPosRoute = location.pathname === "/pos";

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const userMenu = user ? (
    <div className="admin-user-menu">
      <span className="admin-user-name" title={user.email}>
        {user.full_name || user.email}
        {user.location_label ? (
          <span className="admin-user-location"> · {user.location_label}</span>
        ) : null}
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={handleLogout}
      >
        Sign out
      </button>
    </div>
  ) : null;

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
      <header className="admin-header">
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
          <nav id="admin-main-nav" className="admin-nav" aria-label="Main">
            {nav.map((item) =>
              item.children ? (
                <AdminNavGroup
                  key={item.label}
                  label={item.label}
                  items={item.children}
                  pathname={location.pathname}
                />
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `admin-nav-link${isActive ? " admin-nav-link--active" : ""}`
                  }
                >
                  {item.label}
                </NavLink>
              )
            )}
            {colorThemeMenu}
            {userMenu}
            {themeToggle}
          </nav>
        </div>
      </header>
      <main className={isPosRoute ? "admin-main admin-main--pos" : "admin-main"}>
        <Outlet />
      </main>
    </div>
  );
}
