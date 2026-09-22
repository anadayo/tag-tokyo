# TAG TOKYO live launch checklist

TAG TOKYO is free to use, but live matching must not be enabled until every item below is complete.

## Required before enabling real interaction

- Obtain legal advice and submit the required notification for an internet dating introduction business, if the released service meets the statutory definition.
- Use a compliant age-verification provider before live participation. A self-declaration checkbox or birth-date form is only for preview mode.
- Publish terms, privacy policy, location-data purpose, retention period, and a contact channel before collecting real profile or location data.
- Assign an owner for report review, urgent escalation, account suspension, and law-enforcement contact. Test those actions end to end.
- Apply and test every Supabase migration, RLS policy, scheduled deletion job, private photo bucket, and backup/incident procedure in the production project.
- Keep both `NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED` and `live_launch_controls.live_interactions_enabled` false until all checks are signed off by the owner.
- Rehearse report review, account pause, deletion request, and the emergency stop with distinct member and moderator accounts.

## Product rules that remain free

- No payment is required to create a profile, send a mutual TAG, exchange messages, or use TAG SPOT rewards.
- Current location, exact distance, and movement history are never shown to other users.
- Area contributions use location only for a server-side 1km check.

## Official references

- [National Police Agency: Internet dating introduction business requirements and age checks](https://www.npa.go.jp/policy_area/no_cp/deai/regulatory.html)
- [National Police Agency: permitted methods of confirming a user is not a child](https://www.npa.go.jp/policy_area/no_cp/deai/rule.html)
- [Personal Information Protection Commission: considerations when using third-party platforms](https://www.ppc.go.jp/news/careful_information/use_AP_provided_by_3rdparty/)
