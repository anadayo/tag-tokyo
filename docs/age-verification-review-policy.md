# Age verification review policy

The review is an objective 20+ eligibility check, not an identity, appearance, nationality, or suitability assessment.

## Approve only when all three are readable

1. Age or date of birth proves the applicant is at least 20 on the review date.
2. The government-issued document type is identifiable.
3. The issuing authority is identifiable.

The applicant must mask name, address, portrait, document number, and all unrelated fields. Do not transcribe or retain any image content.

## Reject and request resubmission

- Any required field is hidden, cropped, blurred, expired, inconsistent, or unreadable.
- The visible age/date of birth does not prove the applicant is 20 or older.
- The document or issuing authority cannot be identified as a supported public document.

Do not guess. Borderline, altered, or unfamiliar documents stay unapproved and are escalated to the owner. Never base a decision on the portrait or any other personal characteristic.

## After the decision

1. Record approve or reject through the moderation RPC.
2. Delete the evidence image immediately and confirm `evidence_deleted_at`.
3. Send the fixed approval or resubmission email from the notification outbox.
4. Keep only the case ID, decision, timestamps, reviewer, and delivery status. Never copy evidence or email addresses to Notion.
