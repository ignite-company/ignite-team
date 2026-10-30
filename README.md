# Ignite Team

Private operations dashboard for Ignite Co's team performance. iOS-inspired glass interface, Supabase authentication, and dedicated team activity tables in the existing Ignite backend.

## Status
- Admin sign-in uses existing Ignite HQ Supabase account.
- Add and edit team members, assign optional GoHighLevel user IDs.
- Record daily call totals, pickups, pitches and interested prospects.
- Manage appointments and attendance, deals, and explicit cash attribution.
- Revenue amounts always come from existing Ignite HQ payment events.
- Automatic GHL ingestion requires an integration secret and matching GHL workflow. Manual and synced activity remain separate.
- No sample or fabricated revenue figures.

## Setup
1. Deploy the static website to Vercel from this repository.
2. The deployed `ignite-team-api` Supabase Edge Function and its database tables are hosted in the Ignite client-hub Supabase project.
3. Sign in with an **existing admin** account from Ignite HQ.
4. In **Integrations**, generate the single-use GHL webhook connection key and configure matching HighLevel Custom Webhook workflows. No server-side secret needs to be pasted into GitHub or the browser source.
5. Map each caller's **GHL User ID** under Team Members, then test actual call and appointment events.

Read `INTEGRATIONS.md` for event mapping and important limitations.

Security: no public read access to team tables. The Edge API checks the signed-in user's verified Supabase identity and admin role for every management request. Never expose a service-role key in the browser.
