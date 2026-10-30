# Ignite Team: live data and GHL integration

## What is already deployed

- Authenticated API: `https://ujvuqbgheewbyvfusqvz.supabase.co/functions/v1/ignite-team-api`
- Webhook receiver: `https://ujvuqbgheewbyvfusqvz.supabase.co/functions/v1/ignite-team-ghl`
- Database: existing Ignite client-hub project. Tables are protected by RLS and direct access by `anon` and `authenticated` is revoked.
- Permissions: the admin API verifies a Supabase session and requires `user_profiles.role = 'admin'`.
- GHL webhook protection: a SHA-256 hash of a randomly generated key is held in the private integration table. The clear key appears only once in the admin dashboard after generation. All webhook requests require `X-Ignite-Team-Key`.

The static website resides in the repository root. Deploy it to Vercel from the `main` branch. Do not expose any Supabase service-role key in the browser or the repository.

## Data behavior

| Data | How it arrives | Used for |
|---|---|---|
| Team members | Add Team Member | Roster, targets and GHL-user mapping |
| Reported calls | Daily activity form | Manual call totals and funnel counts |
| Observed calls | Signed GHL call webhook | Individually recorded outbound dial attempts |
| Appointments | Manual form or signed GHL webhook | Bookings and show/no-show outcomes |
| Deals | Deals form | Setter, closer, contract value and closing outcomes |
| Collected cash | Existing `hq_revenue_events` | Verified successful payment amounts |
| Payment attribution | Revenue > Attribute | Connect an existing transaction to a deal |

**Do not count the same calls in both manual daily activity and synchronized call events.** A green configured state only means the webhook key exists. It does not prove live GHL ingestion. Confirm an observed call appears before relying on the sync.

**Show rate** is `showed / (showed + no_show)` among finalized outcomes, not the number of bookings and not a prospective show-rate estimate.

## Steps to connect GoHighLevel

1. Sign into Ignite Team with an existing Ignite HQ administrator account.
2. Choose **Team Members** and create each caller. Add their exact GHL User ID.
3. Choose **Integrations > Generate connection key**. Copy the secret once and store it in your secure password manager. Rotating it invalidates the previous key.
4. In HighLevel, go to **Automation > Workflows**, create a workflow with **Call Details** as the trigger, filter to outgoing calls, and configure **Allow Re-entry** so later calls for the same contact are not silently dropped.
5. Add a **Custom Webhook** action using method `POST`, with the webhook URL shown above and header `X-Ignite-Team-Key: <generated-key>`. Use a JSON payload containing a stable unique call ID and GHL user ID.
6. Create a second workflow for appointment created / appointment status changed, with the same header and endpoint but an appointment payload. For meetings, supply the actual person who booked it, not automatically the calendar owner if those are different people.
7. Test with one real outbound call and one real appointment. Verify the proper caller and attendance status in the dashboard. Check for duplicated events and mismatched user IDs.
8. Once call sync is proven, stop manually logging those same call attempts.

Reference: HighLevel's **Call Details** workflow trigger and **Custom Webhook** action documentation. The workflow field picker determines which dynamic merge fields exist in your location and plan. Never guess a missing `event_id` or `ghl_user_id`.

## Recommended call webhook JSON

```json
{
  "type": "call",
  "event_id": "<unique GHL message or call ID>",
  "ghl_user_id": "<exact GHL caller user ID>",
  "direction": "outbound",
  "occurred_at": "2026-10-30T14:30:00Z",
  "outcome": "completed",
  "ghl_contact_id": "<GHL contact ID>",
  "contact_name": "Optional prospect name",
  "pitched": false,
  "interested": false
}
```

Valid outcome labels map to answered, voicemail, busy, no-answer and failed. **Use `pitched` and `interested` only with real disposition information.** Do not mark every answered call as pitched. With a stable event ID, retries update the same event instead of incrementing dial counts twice.

If using HighLevel's marketplace `OutboundMessage` call shape, the receiver also accepts `messageId`, `userId`, `dateAdded`, `callStatus`, `contactId`, `direction` and `messageType: CALL`, provided the request carries the Ignite Team key. Marketplace webhook signatures are a separate mechanism and do not replace this project's custom key.

## Recommended appointment webhook JSON

```json
{
  "type": "appointment",
  "appointment_id": "<stable GHL appointment ID>",
  "ghl_user_id": "<exact user ID of the setter>",
  "company_name": "Prospect Business",
  "contact_name": "Business owner",
  "scheduled_at": "2026-10-31T15:30:00Z",
  "appointment_status": "confirmed",
  "ghl_contact_id": "<GHL contact ID>"
}
```

Statuses supported: `booked`, `confirmed`, `showed`, `no_show` and `canceled`. When HighLevel provides `appointmentStatus`, `assignedUserId`, `id`, `contactId`, and `startTime` within an `appointment` object, the receiver also accepts that form. Use an explicit timezone or `Z` in times. A stable appointment ID updates the existing record.

## Cash reporting rules

The app reads successful payment entries from HQ's existing ledger, including Whop and manually recorded receipts. No money is created by marking a deal Won. A deal's contract value is **potential value**, not collected cash. A payment can be attributed to **one** deal and counted once in company total. For individual rankings, sourced cash credits the deal's setter. Closer information stays on the deal to prevent double-counting. To remove attribution, use **Unlink**; it does not remove the original HQ payment.

The app currently requests the latest 365 days of payments and 120 days of call history. For large teams and longer history, replace the limited activity fetch with server-side aggregate SQL and pagination before relying on all-time totals.

## Deployment and testing

GitHub: https://github.com/ignite-company/ignite-team

To deploy, create a **Vercel project** connected to `ignite-company/ignite-team` with root directory `/` and **Other** (static) framework, then select the `main` branch. No build or output directory is necessary for the plain HTML/CSS/JS site.

Recommended acceptance tests:
- Authorized admin can sign in; unauthorized accounts are blocked.
- Add a member, edit their target, set them inactive; member record persists.
- Add a daily call log, update the same day, and confirm no duplicates.
- Book an appointment; change its status to Showed or No-show and confirm show-rate calculations.
- Add a deal, mark Won, and verify cash remains unchanged.
- Attribute a real HQ payment to a deal, then unlink it. Original HQ amount must not change.
- Generate a webhook key and test a properly keyed GHL call, plus one deliberately invalid key which must be rejected.
- Reload on desktop and mobile; verify frosted-glass layout and navigation.

### Known boundaries

- Adding a Team Member creates a **roster entry**, not a Supabase login or GHL employee login.
- Existing HQ payment events are real, but older receipts are **not automatically attributed** to a specific team member. They require explicit deal matching.
- GHL workflows must be configured within your HighLevel account to produce actual live call records. This repository cannot create them without access to that account.
- Publicly viewable static app assets contain no service credentials; financial data is delivered through an authenticated admin-only API.
