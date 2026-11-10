# Supabase Auth + JWT setup

1. Create a Supabase project and copy its project URL and **publishable** key. The publishable key is safe to use in the browser; never put a secret or `service_role` key in a `VITE_` variable.
2. In Supabase, open **Authentication → Providers** and enable Email. Choose whether new accounts require email confirmation.
3. Run [`supabase/schema.sql`](supabase/schema.sql), then [`supabase/safety-map.sql`](supabase/safety-map.sql), in the Supabase SQL editor. The second migration creates the map/contact/SOS tables, row-level security policies, authenticated RPCs, and Realtime publication entries. Keep RLS enabled.
4. Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and set `VITE_MAPTILER_KEY` to a MapTiler key restricted to your development and production website origins. Replace `VITE_SUPPORT_EMAIL` with a real mailbox before launch; it defaults to a clearly marked placeholder. Restart `npm run dev` after changing variables. Without a MapTiler key, the map uses OpenStreetMap/CARTO fallback layers. Optionally set `VITE_OSRM_BASE_URL` to your own compatible OSRM endpoint; the default public endpoint is for development and has usage limits.
5. Create an account in the app, confirm the email if confirmation is enabled, and sign in. Supabase Auth signs the access JWT and refreshes it; the app sends that JWT through the Supabase client. No JWT signing secret is exposed in frontend code.

If you previously created the Clerk version of `user_data`, its `clerk_user_id` values cannot be mapped to Supabase user IDs automatically. Export and deliberately migrate that data before replacing the old table/schema. Never disable row-level security to make the migration pass.

## Interactive map setup and limitations

- The public landing page includes an interactive map. **Show my live location** starts foreground device tracking only after browser permission; **Stop live location** stops updates. It displays the latest coordinates locally and does not upload or share them.
- Open **Interactive map**, choose **My location** or **Start GPS tracking**, and grant the browser permission. Geolocation works on `localhost` or HTTPS. Tracking is device-local until a journey is started with at least one selected accepted contact.
- In **Trusted contacts**, create an invitation for the other person's sign-in email. The app does not send email or SMS: copy the invitation code and share it directly with that person. They must create/confirm their own account with the matching email and accept the code. You can revoke the relationship at any time.
- Search results use the public OpenStreetMap Nominatim service and are throttled/cached in the browser. Routing uses OSRM. Public endpoints have usage policies, rate limits, and no production availability guarantee; use appropriate hosted services for production.
- Starting a journey requires GPS, a calculated driving route, and explicitly selected accepted contacts. The database stores only the latest location, not a location history; location publishing is authenticated, server-validated, and rate-limited. Shares expire after the selected 30, 60, or 120 minutes, and **Stop sharing now** revokes them and clears the latest location when no other share remains.
- Incoming and outgoing SOS alerts are in-app only, expire after 30 minutes, and require recipient acknowledgement to show as acknowledged. The app does **not** send SMS, place calls, or contact emergency services. Do not rely on it for emergency response.
- Test authorized sharing and alert acknowledgement with two separate accounts. Confirm the recipient's account email matches the invitation, and verify that revocation or expiry removes access. An installed migration is required; the UI displays database errors if the map tables/functions are missing.

Without Supabase credentials, the local dashboard preview remains available, and the map can still request device GPS and calculate a demo route. Trusted-contact sharing and SOS database workflows require authenticated Supabase accounts and the map migration.
