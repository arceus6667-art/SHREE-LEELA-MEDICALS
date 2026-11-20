import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext.tsx';

// Customer & Public Storefront Pages
import { HomePage } from './pages/storefront/HomePage.tsx';
import { CategoriesPage, PharmacyPage, QuickOrderPage, SearchPage } from './pages/storefront/CatalogPages.tsx';
import { MedicineDetailPage } from './pages/storefront/MedicineDetailPage.tsx';
import { UploadPrescriptionPage } from './pages/storefront/UploadPrescriptionPage.tsx';
import { CartPage, CheckoutPage } from './pages/storefront/CartCheckoutPages.tsx';
import { LoginPage, RegisterPage } from './pages/storefront/AuthPages.tsx';
import { AccountOrdersPage, AccountPage } from './pages/storefront/AccountPages.tsx';
import { TrackOrderPage } from './pages/storefront/TrackOrderPage.tsx';
import { ContactPage } from './pages/storefront/ContactPage.tsx';

// Pharmacy Administration Pages
import {
  AdminLiveTrackingPage,
  AdminOrdersPage,
  AdminOverviewPage,
  AdminPrescriptionsPage,
} from './pages/admin/AdminOperationsPages.tsx';
import {
  AdminCategoriesPage,
  AdminCustomersPage,
  AdminInventoryPage,
  AdminMedicinesPage,
} from './pages/admin/AdminCatalogInventoryPages.tsx';
import {
  AdminDeliveryPartnersPage,
  AdminPaymentsPage,
  AdminReportsPage,
  AdminSettingsPage,
} from './pages/admin/AdminManagementPages.tsx';
import {
  AdminAuditLogsPage,
  AdminBulkImportPage,
  AdminContentPage,
  AdminSuppliersPage,
} from './pages/admin/AdminErpPages.tsx';
import { AdminOnboardingPage } from './pages/admin/AdminOnboardingPage.tsx';

// Delivery Partner Pages
import {
  DeliveryAssignmentsPage,
  DeliveryCashSummaryPage,
  DeliveryDashboardPage,
  DeliveryHistoryPage,
  DeliveryOrderDetailPage,
  DeliveryProfilePage,
} from './pages/delivery/DeliveryPages.tsx';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          {/* Public & Customer Routes */}
          <Route path="/" element={<HomePage />} />
          <Route path="/pharmacy" element={<PharmacyPage />} />
          <Route path="/quick-order" element={<QuickOrderPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/medicine/:slug" element={<MedicineDetailPage />} />
          <Route path="/upload-prescription" element={<UploadPrescriptionPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/orders" element={<AccountOrdersPage />} />
          <Route path="/track/:orderId" element={<TrackOrderPage />} />
          <Route path="/contact" element={<ContactPage />} />

          {/* Pharmacy Administration Routes */}
          <Route path="/admin" element={<AdminOverviewPage />} />
          <Route path="/admin/orders" element={<AdminOrdersPage />} />
          <Route path="/admin/orders/:orderId" element={<AdminOrdersPage />} />
          <Route path="/admin/inventory" element={<AdminInventoryPage />} />
          <Route path="/admin/bulk-import" element={<AdminBulkImportPage />} />
          <Route path="/admin/medicines" element={<AdminMedicinesPage />} />
          <Route path="/admin/categories" element={<AdminCategoriesPage />} />
          <Route path="/admin/suppliers" element={<AdminSuppliersPage />} />
          <Route path="/admin/prescriptions" element={<AdminPrescriptionsPage />} />
          <Route path="/admin/customers" element={<AdminCustomersPage />} />
          <Route path="/admin/delivery-partners" element={<AdminDeliveryPartnersPage />} />
          <Route path="/admin/live-tracking" element={<AdminLiveTrackingPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/admin/content" element={<AdminContentPage />} />
          <Route path="/admin/reports" element={<AdminReportsPage />} />
          <Route path="/admin/audit" element={<AdminAuditLogsPage />} />
          <Route path="/admin/onboarding" element={<AdminOnboardingPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />

          {/* Delivery Partner App Routes */}
          <Route path="/delivery/login" element={<LoginPage isDeliveryPortal />} />
          <Route path="/delivery/dashboard" element={<DeliveryDashboardPage />} />
          <Route path="/delivery/assignments" element={<DeliveryAssignmentsPage />} />
          <Route path="/delivery/cash" element={<DeliveryCashSummaryPage />} />
          <Route path="/delivery/order/:id" element={<DeliveryOrderDetailPage />} />
          <Route path="/delivery/history" element={<DeliveryHistoryPage />} />
          <Route path="/delivery/profile" element={<DeliveryProfilePage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
