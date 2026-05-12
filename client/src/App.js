import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./layout/AdminLayout";
import { CategoriesPage } from "./pages/CategoriesPage";
import { CurrenciesPage } from "./pages/CurrenciesPage";
import { CustomersPage } from "./pages/CustomersPage";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryProductLocationsPage } from "./pages/InventoryProductLocationsPage";
import { InventoryPromisesPage } from "./pages/InventoryPromisesPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { MovementNewPage } from "./pages/MovementNewPage";
import { MovementPage } from "./pages/MovementPage";
import { MovementTypesPage } from "./pages/MovementTypesPage";
import { LocationsPage } from "./pages/LocationsPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ProductsPage } from "./pages/ProductsPage";
import { PosPage } from "./pages/PosPage";
import { VatPage } from "./pages/VatPage";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<Navigate to="/pos" replace />} />
          <Route path="pos" element={<PosPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="currencies" element={<CurrenciesPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="products/:id" element={<ProductDetailPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="movement/new" element={<MovementNewPage />} />
          <Route path="movement" element={<MovementPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/product/:productId" element={<InventoryProductLocationsPage />} />
          <Route path="promises" element={<InventoryPromisesPage />} />
          <Route path="movement-types" element={<MovementTypesPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="vat" element={<VatPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
