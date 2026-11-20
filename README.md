# Shree Leela Medical & General Stores — Pharmacy Platform Foundation

Integrated pharmacy e-commerce, prescription verification, batch inventory, administration, and live GPS delivery management platform for **Shree Leela Medical & General Stores** (Gaurav Avenue, near GCC Club, Hatkesh Road, Mira Road East, Maharashtra, India).

## Architecture Overview

All three panels communicate through a unified Node.js + Express + Socket.IO backend on port `3000`:

1. **Customer Storefront (`/`, `/pharmacy`, `/categories`, `/search`, `/medicine/:slug`, `/upload-prescription`, `/cart`, `/checkout`, `/account`, `/track/:orderId`, `/contact`)**
2. **Pharmacy Administration Dashboard (`/admin/*`)** — RBAC-protected for `SUPER_ADMIN`, `STORE_ADMIN`, `PHARMACIST`, and `INVENTORY_MANAGER`
3. **Delivery Partner Application (`/delivery/*`)** — RBAC-protected for `DELIVERY_PARTNER` with live GPS streaming over Socket.IO

### Service Layer Abstraction (Supabase & PostgreSQL Ready)

Core infrastructure is isolated behind clean interfaces in `src/server/interfaces/services.ts`:
- `IDatabaseService` — Transactional relational persistence (local Node SQLite runtime in `./data/shree_leela_pharmacy.db` + full PostgreSQL Prisma schema & migration in `prisma/`)
- `IAuthService` — `bcryptjs` (cost 12) password hashing, HTTP-only signed session cookies, email verification & password reset tokens, server-side RBAC
- `IStorageService` — Persistent object storage adapter (`./data/uploads`) for prescriptions and replaceable store logo/photos
- `IRealtimeService` — Socket.IO room-isolated event emitter (`order:<id>`, `store:<id>:admin`, `driver:<id>`)
- `IMapsAdapter` — Google Maps integration adapter with coordinate/ETA calculations and configurable Google Maps JS API key support

## Running Locally

```bash
npm install
npm run dev
```

The server listens on `http://localhost:3000`.

## Demonstration Mode Notice

Sample medicines, batch numbers, prices, and sample orders seeded on initial boot are flagged `isDemoData = true` and labeled **Demonstration Data** in the UI. Administrators can update store details, upload real store branding/photos, and toggle demonstration banners under `/admin/settings`.
