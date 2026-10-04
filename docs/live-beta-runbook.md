# TAG TOKYO live-beta runbook

This runbook is for a real-user limited beta. Fabricated users and rankings are not used.

## Hard launch gate

All of these must be complete before `NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED=true` is deployed:

1. Keep service-role keys out of GitHub Pages. Client moderation actions must use authenticated Supabase RPC and RLS only; scheduled cleanup and alerts must run in Supabase Edge Functions or another server runtime.
2. The owner has obtained legal advice on whether the planned service falls within the Internet Dating Introduction Business rules, and has completed any required notification.
3. An operator reviews the masked government-ID image and confirms the required three fields before `users.age_verified` and `age_verification_status` change to verified. The app never accepts a checkbox, birth-date form, or client claim as proof.
4. Migrations through `016_official_owner_profile.sql` have been applied in a production Supabase project. RLS, upload, review, decision email, evidence deletion, mutual-TAG messaging, official-owner visibility, rate limits, block, and report flows have been tested using separate member and moderator accounts.
5. One owner and at least one moderator have been assigned. They have rehearsed report review, user pause, restoration, deletion requests, and an urgent service stop.
6. Terms, privacy policy, contact channel, retention periods, and prohibited conduct are reviewed by the owner and published with version numbers.
7. The owner records the review in `live_launch_controls`; database control remains `false` until the final go/no-go decision.

The client environment flag alone does not authorise live interactions. The database control must also be enabled by an authorised operator after this runbook is signed off.

## Server functions and secrets

- Schedule `cleanup-private-data` at least hourly with `CRON_SECRET`; it calls the existing database cleanup RPC for expired location samples and crossings.
- Deploy `send-age-verification-notifications`, configure `RESEND_API_KEY`, `TAG_TOKYO_FROM_EMAIL`, and `SITE_URL`, then send approval and rejection test emails to an owner-controlled address before accepting submissions.
- The current flow is manual review at `/moderation/`. Keep `age-verification-webhook` disabled unless a contracted provider replaces manual review.
- Store `AGE_VERIFICATION_WEBHOOK_SECRET`, `CRON_SECRET`, and the Supabase service-role key only in the function runtime. Never put them in `.env` files committed to Git or `NEXT_PUBLIC_` variables.
- The webhook stores only provider method, opaque verification reference, status, and verification time. It rejects unsigned payloads and cannot be used to claim verification from the client.

## Personal-data boundary

- Supabase Auth holds email authentication.
- The app database holds consent versions, a verification-provider reference, and moderation case data.
- Masked identity-document images stay only in the private `age-verification-evidence` bucket until the decision. Never copy them to the database, logs, analytics, Notion, or a public URL.
- The moderator checks only age/date of birth, document name, and issuing authority, records the decision, deletes the original immediately, and confirms `evidence_deleted_at` was written.
- A review decision creates a notification-outbox row. Delivery failures remain visible as `failed` and can be retried without changing the decision or restoring the deleted image.
- Profile images are placed only in the private `profile-photos` bucket, under `<auth-user-id>/...`; never use public URLs.
- Notion receives only case IDs, status, assignee, timestamps, and redacted operational summaries.

## Moderation operating target

- Critical safety report: acknowledge and pause relevant account access promptly; preserve case metadata; escalate according to the approved emergency procedure.
- Standard report: assign a moderator, review the case, record the action through `review_report`, and notify the reporter through the approved support channel.
- Never add report evidence, email addresses, precise locations, or photographs to Notion.
- Do not use an automated model as the sole decision maker for suspension or account restoration.

## Weekly checks

- Review open reports, deletion requests, failed age verification attempts, and access logs.
- Confirm scheduled cleanup deleted expired location samples and crossings.
- Test a non-owner account cannot read another user's email, exact location, unshared photo, report, or deletion request.
- Confirm `live_interactions_enabled` is still false outside the approved beta window.

## Emergency stop

1. Set `live_launch_controls.live_interactions_enabled` to `false` using an owner-only operator procedure.
2. Remove the deploy-time `NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED` flag and deploy the inactive build.
3. Stop scheduled crossing detection.
4. Record the incident without copying sensitive evidence into Notion.
5. Restore only after the owner documents the cause and verifies the fix.
