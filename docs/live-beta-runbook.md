# TAG TOKYO live-beta runbook

This runbook is for a real-user limited beta. It is not a checklist for turning on a demo.

## Hard launch gate

All of these must be complete before `NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED=true` is deployed:

1. Move the live app off static GitHub Pages to a server-capable deployment. Age-verification webhooks, service-role keys, and moderation alerts must run only in Supabase Edge Functions or another server runtime.
2. The owner has obtained legal advice on whether the planned service falls within the Internet Dating Introduction Business rules, and has completed any required notification.
3. A contracted age-verification provider returns a verified result before `users.age_verified` and `age_verification_status` can be changed to `verified`. The app never accepts a checkbox, birth-date form, or client claim as proof.
4. Migration `008_live_safety_operations.sql` has been applied in a production Supabase project and its RLS policies have been tested using separate member and moderator accounts.
5. One owner and at least one moderator have been assigned. They have rehearsed report review, user pause, restoration, deletion requests, and an urgent service stop.
6. Terms, privacy policy, contact channel, retention periods, and prohibited conduct are reviewed by the owner and published with version numbers.
7. The owner records the review in `live_launch_controls`; database control remains `false` until the final go/no-go decision.

The client environment flag alone does not authorise live interactions. The database control must also be enabled by an authorised operator after this runbook is signed off.

## Server functions and secrets

- Schedule `cleanup-private-data` at least hourly with `CRON_SECRET`; it calls the existing database cleanup RPC for expired location samples and crossings.
- `age-verification-webhook` is an adapter endpoint, not a browser endpoint. Configure a verification provider or trusted relay to send the documented JSON envelope with an HMAC-SHA256 signature in `x-tag-verification-signature`.
- Store `AGE_VERIFICATION_WEBHOOK_SECRET`, `CRON_SECRET`, and the Supabase service-role key only in the function runtime. Never put them in `.env` files committed to Git or `NEXT_PUBLIC_` variables.
- The webhook stores only provider method, opaque verification reference, status, and verification time. It rejects unsigned payloads and cannot be used to claim verification from the client.

## Personal-data boundary

- Supabase Auth holds email authentication.
- The app database holds consent versions, a verification-provider reference, and moderation case data.
- The verification provider holds any identity-document material. Do not copy document images, ID numbers, or raw verification payloads into Supabase or Notion.
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
2. Remove the deploy-time `NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED` flag and deploy the preview build.
3. Stop scheduled crossing detection.
4. Record the incident without copying sensitive evidence into Notion.
5. Restore only after the owner documents the cause and verifies the fix.
