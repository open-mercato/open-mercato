# Test Scenario: Subject + Participants Last-Ditch Threading

## Test ID
TC-CHANNEL-EMAIL-026

## Category
Communications Hub / Threading / Spec B § Phase B3

## Priority
Low — last fallback before opening a new thread.

## Description
When neither `om_*` token nor JWZ headers are present (mailing-list rewrite, gateway translation), the matcher normalises the inbound subject (`Re:`, `Fwd:`, `[EXTERNAL]` stripped) and tests participant-set overlap (>= 50 %). Low-confidence threading; better than always creating a new thread.

## Prerequisites
- A pre-existing thread with subject "Quote #123" between alice@example.com and bob@example.com.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Inject an inbound message from `alice@example.com` to `bob@example.com` with subject `Re: Quote #123` and no References / In-Reply-To. | Threads to the existing "Quote #123" conversation. |
| 2 | `threadMatchStrategy` = `subject-participants`; `threadMatchConfidence` = `low`. | Confirmed. |
| 3 | Try the same with subject `Quote #999` (no normalisation match). | Opens a NEW thread. |

## Pass Criteria
- Subject-normalisation match works for `Re:` / `Fwd:` / `[EXTERNAL]` prefixes.
- Participant overlap correctly prunes false positives.

## Fail Criteria
- Any non-matching pair threads incorrectly (cross-conversation pollution).
