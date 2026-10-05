# TAG TOKYO v0.5 implementation status

Updated: 2026-10-05

## Implemented in code

- Existing account and progression data remain intact; migrations are additive.
- 500 unique database-backed tags in 20 categories, alias search, popular/recent ordering.
- Five to 50 selected tags and up to five primary tags.
- Recommendation scoring based on common and rarer tags; five common tags required.
- CROSS requires five common tags and suppresses duplicate pairs for six hours.
- TAG ON sessions can be restored after reload while the server session is active.
- Chat persists in Supabase and includes unread count, read state, date separators and reactions.
- Active-status labels use broad time bands and never reveal exact login time.
- Match cancellation, block and report controls.
- RLS keeps reactions and messages visible only to match participants.
- Existing location privacy, 20+ verification, rate limits and movement validation remain enabled.

## Partial or pending production setup

- Migrations `022_tag_collection_v05.sql` and `023_live_experience_v05.sql` must be applied to production Supabase.
- Supabase Edge Functions for scheduled cleanup and crossing detection must be deployed and scheduled.
- Real-user interaction stays disabled until the required notification number and operational readiness are confirmed.
- The UI deliberately shows "20歳以上確認済み" instead of retaining or exposing exact age.

## Deferred (P2)

- Paid boosts, subscriptions and payment processing.
- Referral rewards.
- Voice/video calls and image messages.

## Verification

- TypeScript: passed.
- ESLint: passed.
- Next.js production build: passed.
- Mobile viewport (390 x 844): profile and TAG COLLECTION editor checked.
- Catalog source check: 500 entries, 500 unique.
- Two real-account CROSS/MATCH/chat test: pending production migration and controlled test accounts.
