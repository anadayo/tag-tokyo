# TAG TOKYO v3.0 release readiness

Updated: 2026-10-09

## Current decision

**Public beta: LIVE by owner decision / Formal release verification: IN PROGRESS**

The application build is healthy. The owner confirmed the applicable operating requirements and approved live beta interaction. Production database migrations, transactional E2E and physical-device checks below remain required before declaring formal-release verification complete.

## Implemented

- MapLibre 3D map with GPS recentering, heading, accuracy radius, manual pan/zoom/rotation and lightweight mode
- Day/night map styles and non-blocking location errors
- Thirty unique Yamanote Line station areas and TAG SPOT definitions, while retaining Kitasenju and existing non-Yamanote spots
- One-kilometre area EXP action and 150-metre spot gacha actions backed by fresh server-side GPS checks
- Area total EXP, participant count and the current user's rank RPC
- CROSS preference guard, active TAG-session guard, shared-tag rule, block rule and six-hour duplicate suppression
- Chat maximum length, duplicate/rate limits and configurable 120-message retention
- Public privacy-policy text for message retention

## Automated checks run locally

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm build      PASS
git diff --check PASS
```

## Production checks still required

1. Apply migrations `035_kitasenju_asakusa_map_spots.sql` and `036_yamanote_network_and_match_safety.sql` in order.
2. Run `supabase/tests/001_live_community_e2e.sql` and `supabase/tests/002_tag_map_e2e.sql`; both are transactional and roll back their test data.
3. Verify the 30 station pickup radii from safe public areas. The stored points are station reference coordinates and are not a substitute for field verification.
4. Run two-device iPhone Safari/Android Chrome checks for foreground GPS, realtime chat, reconnect and keyboard layout.
5. Set the public operator notification number and confirm the live-interaction launch control before formal release.

## Test claims

No production DB, physical-device, multi-device realtime or 30-station field test is marked PASS in this document until it has actually been run.
