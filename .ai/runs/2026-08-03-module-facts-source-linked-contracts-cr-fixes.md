# Run plan — module facts source-linked contracts: code-review fixes (PR #4883)

- **PR:** #4883 — `feat(cli): complete source-linked module extension contracts (module facts)`
- **Branch:** `feat/module-facts-source-linked-contracts`
- **Base:** `develop`
- **Status:** in-progress
- **Source specs:**
  - `.ai/specs/2026-08-02-module-facts-source-provenance-and-contract-inventory.md`
  - `.ai/specs/2026-08-02-module-facts-extension-activation-and-incoming-index.md`
  - `.ai/specs/2026-08-02-module-facts-exact-override-targets.md`

## Context

The original PR shipped without a tracking plan. This plan was created during the
`om-auto-continue-pr` resume on 2026-08-03 to track the fixes for the
`om-auto-review-pr` `changes-requested` verdict posted on the PR (10 major + 1 minor
findings). Each Progress row below maps 1:1 to a review finding.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles.

### Phase 1: Provenance index and Markdown source links (review findings Major 3, Major 4)

- [x] 1.1 Make `factSources` the uniform provenance index — every proven `(kind,id)` resolves to a source or a deterministic typed fact reference; keep the byte guard explicit — 4f0b89075
- [x] 1.2 Render portable source links on every represented Markdown fact (entities, events, ACL, DI tokens, search, notifications, UMES hosts/contributions) — 4f0b89075
- [x] 1.3 Render activation IDs/bridges instead of bare `kind`, and add a source-linked contribution-resolution section — 4f0b89075

### Phase 2: Runtime parity for owned contracts (Major 1, Major 2)

- [x] 2.1 Page metadata: honor the runtime companion-file convention (`page.meta.ts` / `meta.ts`) and contract keys (`pageContext`, `pageGroupKey`, `pageOrder`), with a parity fixture — 916aa49f6
- [x] 2.2 Workers: derive the runtime fallback ID for id-less workers, resolve the required `queue`, cover root and nested workers with local-constant queues — 916aa49f6

### Phase 3: Override target coverage (Major 5, Major 6, Minor 1)

- [x] 3.1 AI file contracts: parse `aiAgentOverrides` and `aiToolOverrides` separately, emit exact `ai.agents.<id>` / `ai.tools.<id>` targets without serializing values — ab412ca20
- [x] 3.2 Nested override coverage: emit `notifications.handlers` and `setup.defaultCustomerRoleFeatures` — ab412ca20
- [x] 3.3 Unknown framework override modes emit a diagnostic instead of a guessed `disable-replace` — ab412ca20

### Phase 4: Activation correctness (Major 7, Major 8, Major 9, Major 10)

- [x] 4.1 Enrichers: classify query-engine activation from `queryEngine.enabled === true` only — 203178e9a
- [x] 4.2 API interceptors: derive binding from real bridge call sites, keep method/phase in activation identity — 34833af08
- [x] 4.3 Mutation guards: parse the canonical `runRouteMutationGuards` shape and wrappers, carry operations into matching — cfe32c31c
- [x] 4.4 Dashboard adapter: include the framework host catalog in correlation; behavioral coverage for every adapter — 7053022a1

### Phase 5: Verification and close-out

- [ ] 5.1 Full validation gate (`.ai/agentic.config.json` `validation.commands`)
- [ ] 5.2 `om-code-review` + breaking-change self-review, spec changelog refresh
- [ ] 5.3 `om-auto-review-pr` autofix loop until clean
