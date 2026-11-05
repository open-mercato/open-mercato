# Test Scenario: Threading via References Token (High Confidence)

## Test ID
TC-CHANNEL-EMAIL-023

## Category
Communications Hub / Threading / Spec B § Phase B2-B3

## Priority
High — addresses "replies don't thread back to the right conversation".

## Description
Outbound delivery injects an `om_*` HMAC token into both the `References` header (`<om_TOKEN@open-mercato.invalid>`) and a hidden body footer. When the recipient replies with the `References` header preserved (default for nearly all MUAs), the layered thread matcher selects the `token-references` strategy (highest confidence) and threads the reply back to the original conversation.

## Prerequisites
- A connected IMAP channel with outbound delivery working.
- A CRM contact whose primary email matches the recipient of the outbound message.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Send an email from `/backend/customers/people/<id>` via the "Send email" widget. | Outbound delivery worker injects References + body footer. Check the actual sent message: `References: <om_*@open-mercato.invalid>` and body has hidden `[OM:TOKEN]` marker. |
| 2 | Reply from the recipient's mailbox preserving `References` (default). | Within ~90s the reply appears on the SAME Person timeline as the outbound. |
| 3 | Inspect the inbound `MessageChannelLink.channelMetadata.threadMatchStrategy`. | Equals `token-references`; `threadMatchConfidence` is `high`. |

## Pass Criteria
- Step 1: References header + body footer present in the sent MIME.
- Step 2: reply lands on the same conversation, NOT a new thread.
- Step 3: strategy + confidence recorded for observability.

## Fail Criteria
- Reply creates a NEW thread (matcher missed the token).
- `References` header malformed (e.g. wrong synthetic ID format).

## Related Tests
- TC-CHANNEL-EMAIL-024 (body-footer fallback when References stripped)
- TC-CHANNEL-EMAIL-025/026 (JWZ + subject-participants fallbacks)
