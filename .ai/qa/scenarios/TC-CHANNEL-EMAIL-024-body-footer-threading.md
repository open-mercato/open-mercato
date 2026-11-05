# Test Scenario: Threading via Body Footer (References Stripped)

## Test ID
TC-CHANNEL-EMAIL-024

## Category
Communications Hub / Threading / Spec B § Phase B2

## Priority
High — covers the MUA-strips-References failure mode.

## Description
Some MUAs (Outlook on the web in specific configurations, mailing-list rewrites) strip the `References` header on reply. Our hidden body footer (`<span style="display:none">[OM:TOKEN]</span>` for HTML; `[OM:TOKEN]` plain marker) survives quoting. The matcher's `token-body` strategy (high confidence) threads the reply.

## Prerequisites
- Same as TC-023.
- A test MUA that strips References (or use a mail tool that lets you manually strip it).

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Send an outbound (TC-023 step 1). | References + body footer both present in sent MIME. |
| 2 | Reply with References manually stripped but body left intact (so the `[OM:TOKEN]` footer survives in the quoted block). | Reply lands on the same conversation. |
| 3 | `MessageChannelLink.channelMetadata.threadMatchStrategy` = `token-body`. | Confirmed. |

## Pass Criteria
- Reply threads correctly DESPITE missing References.

## Fail Criteria
- Reply creates a new thread (footer wasn't recognised).
