# Personal data and Notion operations

## Data boundary

- Email addresses, authentication records, terms consent, profile photos, and report evidence stay in Supabase Auth, the application database, and private storage with role-based access.
- Notion is only an operations dashboard. It may contain a report case ID, timestamps, status, assignee, and a redacted summary.
- Never copy raw email addresses, government-ID data, precise locations, profile photos, or message evidence into Notion.

## Before live beta

- Record the terms and privacy-policy version accepted by each user in the application database.
- Limit owner and moderator access, and maintain an access log for report review.
- Give users a way to request account deletion and delete their related personal data according to the published retention policy.
- Configure private photo storage and RLS before accepting real profile photos.
