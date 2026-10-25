# Execution plan — preserve encrypted-search fallback diagnostics (adopted from PR #6827)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-25 because PR #6827 carried no execution plan.
**PR:** #6827 · **Branch:** `codex/fix-issue-6729-encrypted-search` · **Base:** `main`
**Author:** @haxiorz

## Goal

Preserve the development encrypted-search diagnostic after Hybrid's fallback extension pipeline replaces a result, completing the scoped review correction.

## Scope

Hybrid fallback result finalization and focused regression tests in `query_index`.

## Non-goals

No query filtering, tenant scoping, public contract, production payload, schema, migration, dependency, pipeline-policy, P5/#6727 harness-oracle, or P6 changes. Independent review and manual QA remain required.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Development diagnostics must survive the extension pipeline. | PR description and `.ai/specs/2026-10-01-encrypted-list-search-diagnostics.md` | high |
| Empty-index fallback loses diagnostics after replacement subscribers. | Review https://github.com/open-mercato/open-mercato/pull/6827#pullrequestreview-5564806783 | high |
| Existing search and guide implementation is already landed. | Head `3c282c545587d78abaf10548242ba34a3ec0b2d5` | high |

## Assumptions

The existing development-only warning shape and collection rules remain authoritative. The correction restores warnings already produced by Basic rather than detecting new fallback conditions.

## Risks

Finalization must preserve subscriber result items and unrelated metadata, and must not introduce diagnostics in production. All fallback returns need the same protection.

## Progress

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Document encrypted list filtering and expose development diagnostics — 3c282c545587d78abaf10548242ba34a3ec0b2d5

### Phase 2: Address the fallback review finding

- [x] 2.1 Reproduce lost diagnostics with a no-index fallback and replacement subscriber. — b6ea4127d30f03e082e1bc720324fa6655403062
- [x] 2.2 Preserve fallback diagnostics after Hybrid extensions on every fallback return. — b6ea4127d30f03e082e1bc720324fa6655403062
- [x] 2.3 Validate the focused fix and review compatibility, security, and scope. — b6ea4127d30f03e082e1bc720324fa6655403062
- [x] 2.4 Publish evidence and request independent re-review while retaining QA and review gates. — e9433e17bdbed31fe74c73e6d39848217127c336; [follow-up review](https://github.com/open-mercato/open-mercato/pull/6827#pullrequestreview-5643858127), reviewer request: @pkarw.

## Verification evidence

- Runner: local. Docker daemon access was unavailable; dependency overlays were read-only and no repository manifests changed.
- Red: four development fallback cases failed on the absent `ciphertextSearchWarnings` before the fix.
- Green: complete Hybrid suite, 87 tests; shared Basic engine, warning helper, and extension runner suites, 100 tests.
- Lessons catalog check and five focused validator tests passed; `git diff --check` passed.
- Fresh `main` at `774c64847` initially merged cleanly. Adding the focused lesson then conflicted with its updated catalog count, so main was merged and all 154 lesson records were retained with the correct declaration.
- Existing-head CI had 24 successful and five explicitly skipped checks. New-head CI is reported separately and is not inferred from those results.
- Follow-up review found no additional contract, query-semantics, data-scope, production-payload, or privacy change. Independent human review and QA remain pending.
- Post-merge rerun: Hybrid 87/87, shared query suites 100/100, lessons script tests 5/5. The shared Jest process reports its existing open-handle notice and exits successfully without forced termination.
