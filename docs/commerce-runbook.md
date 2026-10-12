# TAG TOKYO commerce runbook

Paid BOOST remains disabled until every launch gate below is complete. The app may show the catalog while disabled, but it cannot create a Checkout Session.

## Products

| Product | Price | Effect |
| --- | ---: | --- |
| BOOST | JPY 800 | CROSS range is 5 km for 30 minutes |
| SUPER BOOST | JPY 1,500 | CROSS range is 10 km for 30 minutes |

Free users keep access to profiles, TAG, matching and messages. A purchase only expands the temporary CROSS range.

## Required setup

1. Apply migration `038_commerce_and_funnel_analytics.sql`.
2. Deploy `create-stripe-checkout` with JWT verification enabled.
3. Deploy `stripe-webhook` with JWT verification disabled.
4. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SIGNING_SECRET` to Supabase Edge Function secrets.
5. Configure the Stripe webhook endpoint for Checkout success/failure/expiry and charge refunds.
6. Set the public seller address and phone environment variables and publish the complete commercial disclosure.
7. Complete operator legal review and Stripe account review.
8. Run `supabase/tests/003_commerce_e2e.sql`, then complete one Stripe test-mode purchase and refund on mobile.

Only after all checks pass, update the single `commerce_controls` row so `legal_review_completed` and `purchases_enabled` are both true. Keep `stripe_test_mode` aligned with the key prefix. Never put Stripe secret keys in GitHub Pages or any `NEXT_PUBLIC_*` variable.

## Incident controls

- Disable sales immediately by setting `purchases_enabled=false`.
- Stripe webhook event IDs and order state prevent duplicate item grants.
- Refunds remove only unused inventory; consumed effects require operator review before a manual adjustment.
- Review `payment_orders`, `commerce_ledger` and `stripe_webhook_events` together when Stripe and app totals differ.
- Do not include email addresses, identity evidence, precise locations, Stripe payloads or secret values in logs.
