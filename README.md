# Shree Leela Medical & General Stores

A pharmacy storefront, store administration workspace and delivery staff portal backed by the same Express service.

## Local setup

1. Install Node.js with `node:sqlite` support and install the locked dependencies with `bun install --frozen-lockfile`.
2. Copy `.env.example` to `.env`. Configure a bootstrap administrator email and long password. The app creates the first administrator when the store has none. Remove the bootstrap variables after the account has been created.
3. Run `bun run dev`. Open the storefront at `http://localhost:3000/`, store administration at `/admin` and delivery staff sign-in at `/delivery/login`.

A new SQLite database starts with the store profile and category structure. Confirm the store profile in Admin Settings and import the real catalogue and stock. Use the admin onboarding flow to configure staff, delivery coverage and store policies before enabling sales. Checkout supports payment on delivery or at the store counter. Online card and UPI checkout require a separate gateway integration and verification.

## Runtime configuration

Set a strong `SESSION_SECRET` and the deployment URL as `APP_URL`. Keep the SQLite path and uploads on persistent storage. A legacy database containing sample accounts is rejected at startup. Preserve existing data separately when switching paths.

To store files in Supabase, create a private Storage bucket and set `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET` and `SUPABASE_SECRET_KEY` on the server. Express retains authorization for file downloads. Migrate existing files to the bucket under their original keys before switching the driver. The application's data queries still use SQLite. The existing Prisma schema and migration are a starting point for a PostgreSQL port and are not applied at runtime.

Set `RESEND_API_KEY` and `EMAIL_FROM` for password recovery. Configure the Google Maps keys for live maps according to the restrictions set in Google Cloud.

Run `bun run lint` for TypeScript checks and `bun run build` for the storefront build.
