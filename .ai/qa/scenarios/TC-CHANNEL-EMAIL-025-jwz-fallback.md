# Test Scenario: JWZ-Headers Fallback Threading

## Test ID
TC-CHANNEL-EMAIL-025

## Category
Communications Hub / Threading / Spec B § Phase B3

## Priority
Medium — exercises the pre-token outbound case (channels connected before Spec B shipped).

## Description
Outbound messages sent before Spec B's token injection landed have no `om_*` token. When the recipient replies, `In-Reply-To` / `References` headers point at our outbound `Message-Id`. The matcher's `jwz-headers` strategy (medium confidence) walks the JWZ algorithm against `external_messages` and threads the reply.

## Prerequisites
- A pre-existing thread whose outbound message has NO `om_*` token (e.g. send via a path that bypasses `deliver-outbound-message`, or use existing demo data).

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Reply to the pre-token outbound preserving `In-Reply-To`. | Reply threads back to the same conversation. |
| 2 | `threadMatchStrategy` = `jwz-headers`; `threadMatchConfidence` = `medium`. | Confirmed. |

## Pass Criteria
- JWZ fallback finds the original conversation.

## Fail Criteria
- Reply creates a new thread.
