# Execution plan — preserve refused CRM reply isolation (adopted from PR #7477)

**Origin:** adopted by `om-auto-continue-pr` on 2026-10-25 from review 5643640619.
**PR:** #7477 · **Branch:** `codex/fix-7469-markdown-code-block-save` · **Base:** `main`
**Author:** @haxiorz

## Goal

Keep the approved Markdown editor correction and restore substantive asynchronous no-write verification for refused CRM email replies.

## Scope

The CRM email integration scenario, its focused queue-settle regression coverage, and review evidence.

## Non-goals

No production editor changes, new queue-control API, QA policy changes, scope split, or generic integration flake work owned by #7897. Existing screenshots and CI evidence remain historical.

## Evidence

| Conclusion | Source | Confidence |
| --- | --- | --- |
| Editor behavior is correct | @wojciechszyjka review 5643640619 | high |
| The refused-reply check needs worker settling | Same review and follow-up comment 6398794468 | high |
| Queue inspection must preserve worker ownership | Existing `getQueuePendingProbe`, local queue handler lifecycle, and related #6891 | high |

## Assumptions

The existing read-only queue pending probe is the supported settle signal. Keep false/unset worker mode's manual drains and retain every footprint counter and denial assertion.

## Risks

A settle probe must fail on storage errors and unfinished jobs, including delayed retries. Full application CI and product QA remain separate evidence.

## Progress

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Publish Markdown control edits immediately with regression coverage and documented CI corrections — 01a8ba8bf

### Phase 2: Review remediation

- [ ] 2.1 Restore the email queue barrier and prove delayed forbidden writes remain detectable
- [ ] 2.2 Review the final diff, publish focused validation evidence, request re-review and release the claim
