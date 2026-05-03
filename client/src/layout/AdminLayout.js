import { NavLink, Outlet } from "react-router-dom";

const nav = [
  { to: "/categories", label: "Categories" },
  { to: "/locations", label: "Locations" },
  { to: "/products", label: "Products" },
  { to: "/customers", label: "Customers" },
];

export function AdminLayout() {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
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
        </nav>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
