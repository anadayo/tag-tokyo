# TAG TOKYO live launch checklist

TAG TOKYO is free to use, but live matching must not be enabled until every item below is complete.

## Required before enabling real interaction

- Submit the required notification for an internet dating introduction business, if the released service meets the statutory definition.
- Use a compliant method to verify that live participants are at least 18. A self-declaration checkbox is only for preview mode.
- Publish terms, privacy policy, location-data purpose, retention period, and a contact channel before collecting real profile or location data.
- Assign an owner for report review, urgent escalation, account suspension, and law-enforcement contact. Test those actions end to end.
- Apply and test every Supabase migration, RLS policy, scheduled deletion job, and backup/incident procedure in the production project.
- Keep `NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED` unset or `false` until all checks are signed off by the owner.

## Product rules that remain free

- No payment is required to create a profile, send a mutual TAG, exchange messages, or use TAG SPOT rewards.
- Current location, exact distance, and movement history are never shown to other users.
- Area contributions use location only for a server-side 1km check.

## Official references

- National Police Agency: Internet dating introduction business requirements and age checks.
- Personal Information Protection Commission: location data handling and privacy notices.
