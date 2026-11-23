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

### Phase 3: Resolve instruction-budget CI regressions

- [x] 3.1 Reproduce current-head root and compatibility budget failures after reconciling latest main. — 5cc76ff0e998653c63a77f4e701efa30befa21f2
- [x] 3.2 Reclaim root routing bytes and include the real classic module-fact index in the existing compatibility regression, preserving all hard caps and encrypted-search guidance. — b3788aad68e6bb2824a76295ed360dacc48ab437
- [x] 3.3 Pass focused budget/safety/routing tests and the unchanged controller-owned failure-before/success-after proof. — b3788aad68e6bb2824a76295ed360dacc48ab437
- [ ] 3.4 Run the certified live release lane on an explicitly authorized, supported host. Blocked: automatic approval review rejected external-model data egress without destination authorization, and Win32 containment is unsupported. Local deterministic/packed proofs do not replace certification.

## CI budget follow-up evidence

- Initial failure: [job 121217361720](https://github.com/open-mercato/open-mercato/actions/runs/40206996557/job/121217361720) reported generated roots at 12,342/12,343 bytes against 12,288 and OMH-057 at 114,723 against 114,688. All four existing assertions failed locally before the owner change.
- Fresh packed classic output exposed additional module-index context omitted by the prior compatibility fixture. That existing test now uses the classic module list, index injection, Codex patch, and budget finalizer, with independent per-case measurements.
- The root owner reclaims 259 bytes. All caps, case policies, validators, oracles, and the knowledge-change controller remain unchanged. The template retains its existing header.
- Focused budget, compatibility, encrypted-search, deployment-safety, and standalone-overlay tests pass 35/35. The root contract subset passes its semantic assertions; its packed-source check remains limited by Win32 `spawnSync npm ENOENT`.
- Compatibility required bytes: OMH-007 122,213/122,880; OMH-022 109,269/110,592; OMH-030 124,252/126,976; OMH-057 114,663/114,688; OMH-064 122,213/122,880. Initial caps and forbidden paths are unchanged.
- Source-link inventory regeneration/check passes: 155 records, 130 source-required records, 32 owners, 132 rendered links. Broader local source-link tests hit Win32 npm-spawn and symlink-privilege limits; no controller or read-policy relaxation was introduced.
- The unchanged knowledge-change controller passes with a real test-only diff: base-plus-test exit 1, corrected head exit 0, exact authoritative/generated hashes verified. The sanitized result is retained with the local handoff artifacts.
- Final coherent build and local tarball extraction agree with the authoritative root hash. All four packed presets scaffold successfully with encrypted-query routing intact: classic 11,973 bytes, empty 12,011, CRM 12,175, WMS 12,102 (hard cap 12,288).
- The final packed classic app, with regular installed files from local core/shared/UI tarballs, passes the complete deterministic catalog, 240/240. This is not the live certification lane. Independent re-review was re-requested from @pkarw after publishing the root correction.
- The previous integration shard ended with only portal-upload TC-WC-037 failing, 199 passing and two flaky cases passing their built-in retries. Latest main does not alter TC-WC-037. No unrelated sync_excel/staff/warranty source change was made for this follow-up.

## Verification evidence

- Runner: local. Docker daemon access was unavailable; dependency overlays were read-only and no repository manifests changed.
- Red: four development fallback cases failed on the absent `ciphertextSearchWarnings` before the fix.
- Green: complete Hybrid suite, 87 tests; shared Basic engine, warning helper, and extension runner suites, 100 tests.
- Lessons catalog check and five focused validator tests passed; `git diff --check` passed.
- Fresh `main` at `774c64847` initially merged cleanly. Adding the focused lesson then conflicted with its updated catalog count, so main was merged and all 154 lesson records were retained with the correct declaration.
- Existing-head CI had 24 successful and five explicitly skipped checks. New-head CI is reported separately and is not inferred from those results.
- Follow-up review found no additional contract, query-semantics, data-scope, production-payload, or privacy change. Independent human review and QA remain pending.
- Post-merge rerun: Hybrid 87/87, shared query suites 100/100, lessons script tests 5/5. The shared Jest process reports its existing open-handle notice and exits successfully without forced termination.
