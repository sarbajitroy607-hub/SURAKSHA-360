# Supabase Auth + JWT setup

1. Create a Supabase project and copy its project URL and **publishable** key. The publishable key is safe to use in the browser; never put a secret or `service_role` key in a `VITE_` variable.
2. In Supabase, open **Authentication → Providers** and enable Email. Choose whether new accounts require email confirmation.
3. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor. It creates a per-user data table protected by row-level security (`auth.uid()`).
4. Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then restart `npm run dev`.
5. Create an account in the app, confirm the email if confirmation is enabled, and sign in. Supabase Auth signs the access JWT and refreshes it; the app sends that JWT through the Supabase client. No JWT signing secret is exposed in frontend code.

If you previously created the Clerk version of `user_data`, its `clerk_user_id` values cannot be mapped to Supabase user IDs automatically. Export and deliberately migrate that data before replacing the old table/schema. Never disable row-level security to make the migration pass.

Without Supabase credentials, the local dashboard preview remains available. Journey status and emergency actions are still demo-only and do not contact emergency services.
