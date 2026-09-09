# Standalone Harness Locale Catalog Completeness

- **Status:** Implementation complete on PR #4757 — full release certification pending
- **Date:** 2026-07-31
- **Scope:** OSS standalone-app agent harness and generated-code evaluation
- **Related:** merged PR #4529, issue #4670, `.ai/specs/2026-07-24-standalone-ai-development-harness.md`, sibling spec `2026-07-31-standalone-harness-canonical-list-ui-enforcement.md`

## TLDR

A Claude Sonnet 5 standalone-module run after PR #4529 called module translation keys without populating the module locale files. Add deterministic locale-catalog completeness to the existing OMH-185 complete-module oracle: literal module-owned UI/navigation keys must resolve to non-empty base-locale values and to non-empty values in every sibling locale file the generated module emits.

This expands OMH-185 rather than adding a translation-only generative duplicate. It changes no runtime i18n API and does not force a fixed locale list on standalone apps.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Add a new case or expand existing coverage? | Expand OMH-185. | OMH-185 already requires visible copy in module i18n; its oracle does not prove that claim. | OK |
| Q2 | Which locales are mandatory? | Require `en.json` plus parity for any sibling locale JSON files the module emits. | This catches incomplete emitted sets without hard-coding every app's locale configuration. | OK |
| Q3 | How should computed keys be handled? | Require at least one statically verifiable module-owned key; leave richer dynamic mappings to generated review. | A fixed oracle must not claim coverage it cannot prove or pass vacuously. | OK |
| Q4 | Should this remain combined with canonical list enforcement? | No; ship separate focused specs on one design PR. | Fresh-context review found each check independently deployable and testable. | OK |

## Overview

OMH-185 currently proves that `useT` and `t` calls appear somewhere in generated TypeScript/TSX and that `src/modules/library/i18n/en.json` exists. Those are intermediate signals, not localization correctness. The JSON file can be empty, malformed, or missing every referenced key while the check still reports localized UI.

The supplied screenshot shows `t('visits.*')` calls in generated UI while the module's i18n files were skipped. This spec binds source references to locale resources through a fixed offline oracle.

## Problem Statement

Missing locale entries produce raw keys or fallback behavior at runtime even though code appears “internationalized.” Routing-only OMH-023 cannot inspect generated artifacts, and artifact existence cannot prove key completeness. Generated review is supplemental and probabilistic. The complete-module acceptance gate needs a deterministic join between literal module-owned references and locale JSON.

## Proposed Solution

Keep `packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs` as the one primary owner. Add bounded literal-key extraction, safe locale JSON parsing, base/sibling resolution, and a new additive `module.locale-catalog` check inside `oracle.module.complete`. Add failure-first fixtures showing the old checks pass missing keys and the new check fails them with schema-valid sanitized diagnostics.

## Scope Boundaries

### In scope

- Literal `library.*` translation references in OMH-185 UI and localized page metadata.
- Required base-locale and emitted-sibling-locale resolution.
- Malformed/blank/non-vacuity and path-safety tests.
- Review bundle synchronization and fresh Claude/Sonnet writable/release proof.

### Out of scope

- Canonical DataTable enforcement; the sibling spec owns it.
- Runtime translation loading, fallback, interpolation, pluralization, or Translation Manager behavior.
- Translation quality beyond non-empty strings.
- Forcing de/es/pl when the generated module emits only the base locale.
- Adding i18next-cli as a dependency.

## Research and Existing-System Findings

- `packages/create-app/agentic/shared/ai/skills/om-backend-ui-design/references/quality-states.md` requires titles, labels, actions, placeholders, validation, states, notifications, and navigation to use translations.
- `packages/create-app/agentic/shared/ai/review-checklist.md` requires visible copy in `i18n/<locale>.json` and locale sync when keys change.
- OMH-023 asserts translation routing decisions only. OMH-185 is the writable complete-module owner and currently checks `useT`/`t` plus file existence without reading JSON.
- The official [i18next extraction guidance](https://www.i18next.com/how-to/extracting-translations) recommends statically reading source to identify keys. [i18next-cli](https://github.com/i18next/i18next-cli) separately supports AST extraction, locale synchronization, and missing-translation status. The harness needs the same conceptual separation in a bounded case-specific implementation.
- The existing oracle already uses the target TypeScript compiler API, safe path traversal, size guards for source, and structured checks. A small fixed JSON/key resolver is sufficient; a new production dependency would add unnecessary surface.

## Goals and Success Criteria

1. `t('library.books.title')` fails when that key is absent, blank, or non-string in `i18n/en.json`.
2. Every emitted sibling locale JSON resolves the same collected module-owned keys to non-empty strings.
3. Shared keys outside `library.*` are not falsely required in the module catalog.
4. Dynamic-only module key usage cannot make the check vacuously pass.
5. Malformed JSON, unsafe paths, excessive locale input, and missing files produce structured sanitized failures without executing target code.
6. The new check ID is additive; OMH-185 and existing validator/result shapes remain stable.
7. Fresh OMH-185 writable, target commands, generated review, related cases, and full requested Claude release suite pass.

## Architecture

### One primary owner

The primary owner is `packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs`. Existing backend-UI guidance already requires locale files. Tests, case prose, and review policy reference this fixed contract; no runner-specific instruction branch is added.

### Literal reference extraction

Parse already allowlisted module TypeScript/TSX with the target TypeScript compiler API and collect:

- string-literal or no-substitution-template first arguments to calls whose terminal expression name is `t`;
- string-literal localized metadata fields used by the generated route, including `pageTitleKey`, `pageGroupKey`, and localized breadcrumb entries.

Retain only `library.*` keys. Do not scrape arbitrary strings, comments, tests, migrations, URLs, or class names. Shared namespaces remain outside this module-catalog claim.

Require a non-empty collected set. A generated module using only computed module keys fails OMH-185 because the fixed oracle cannot verify its catalog. A later expansion may support bounded literal maps with its own failure-first fixtures.

### Safe locale loading

Resolve `src/modules/library/i18n` through `safeTargetEntry` and reject symlinks, path escapes, special files, or missing directories. Require `en.json` as the case base locale.

Enumerate at most 16 sibling `.json` files. Reuse the oracle's 256 KiB source-size ceiling per locale file and add a bounded total locale-byte ceiling. Exceeding either returns a structured failure instead of reading unbounded model output.

Parse JSON defensively. Require a plain object root; resolve dotted keys using own-property checks only, never prototype lookup. Reject dangerous path segments such as `__proto__`, `prototype`, and `constructor` as invalid translation references.

### Catalog resolution

Add `module.locale-catalog` to `oracle.module.complete`:

- Every collected `library.*` reference must resolve in `en.json` to a non-empty string.
- Every emitted sibling locale must resolve every collected reference to a non-empty string.
- Extra keys are allowed.
- Equal English fallback values in a sibling locale are allowed; this check proves presence, not linguistic quality.
- Missing keys, blank values, object/array leaves, malformed JSON, and unsafe/bounded-input failures report locale and key/reason only. Never include full catalog contents, environment values, remote URLs, or absolute paths.

### Fixed result contract

The new check is additive and uses the existing shape:

```ts
type OracleCheck = {
  id: string
  passed: boolean
  requirement: string
}
```

Parser failures remain valid failed checks. They must not become a process crash or invalid harness result, because schema failure is not failure-first evidence.

### Supplemental generated review

Keep generated-code review mandatory for OMH-185 and include emitted locale JSON as inert reviewed sources. Review owns semantic translation quality, interpolation/plural correctness, and dynamic-key reasoning that the deterministic check does not claim.

The fixed oracle remains authoritative for catalog presence; review cannot override a failed check.

## Data Models

No application entity, migration, cache, queue, or persisted data changes.

## API Contracts

No runtime HTTP/i18n API changes. `oracle.module.complete` adds `module.locale-catalog`; OMH-185 keeps its ID, fixture, allowlist, timeout, validator, and release/review lanes. Result-schema fields are unchanged.

## Internationalization Contract

For the fixed complete-module case:

- Module-owned visible copy and localized navigation use stable `library.*` keys.
- `en.json` contains non-empty string leaves for every statically referenced module key.
- Any sibling locale JSON emitted by the generated module contains the same referenced keys with non-empty string leaves.
- `translations.ts` remains reserved for translatable entity fields and cannot satisfy UI locale requirements.
- Shared framework namespaces are excluded from the module catalog check.

## UI/UX and Frontend Architecture

The evaluator implementation changes no runtime UI file, so mockups and the frontend architecture contract are N/A. The supplied screenshot is diagnostic PR evidence and must not be committed with its local path.

## Edge Cases and Failure Scenarios

| Scenario | Expected behavior |
|---|---|
| `t('library.books.title')`, empty `en.json` | Fail with missing key. |
| Key resolves to whitespace | Fail as blank. |
| Key resolves to object/array/number | Fail as non-string visible copy. |
| `de.json` exists but misses one key | Fail sibling parity. |
| Only `en.json` exists | Pass if all collected module keys resolve. |
| Shared `common.actions.cancel` is referenced | Ignore for module-catalog purposes. |
| Only computed `library.*` keys are used | Fail non-vacuity. |
| JSON is malformed | Return schema-valid failed check, not process error. |
| Locale file is oversized or too many siblings exist | Fail before unbounded parsing. |
| Key contains a dangerous prototype segment | Fail as invalid reference. |
| Locale path contains a symlink | Fail through safe-target guard. |
| Claude lane unavailable | Certification remains blocked; no runner substitution. |

## Testing Strategy

### Failure-first oracle tests

Extend `packages/create-app/src/lib/writable-ast-oracles.test.ts`:

1. Stage `useT()`/`t('library.books.title')` and an empty `en.json`. Record that the old `module.localized-ui` check passes, then require `module.locale-catalog` to fail.
2. Prove a populated nested base catalog passes.
3. Prove missing, blank, and non-string leaves fail.
4. Prove complete sibling locales pass and missing sibling keys fail.
5. Prove shared keys are excluded and dynamic-only module keys fail non-vacuity.
6. Prove malformed JSON, dangerous segments, oversized files, excessive locale counts, and symlinks return structured sanitized failures.
7. Prove diagnostics contain repository-relative locale/key facts only.

### Focused and package gates

```bash
node --import tsx --test --test-name-pattern="complete module oracle" packages/create-app/src/lib/writable-ast-oracles.test.ts
yarn workspace create-mercato-app test
```

Then emit a fresh controller and run:

```bash
yarn harness:validate --case OMH-185
yarn harness:validate --runner claude --case OMH-185 --writable-root /absolute/disposable/app --acknowledge-writes
yarn harness:validate --case OMH-023
yarn harness:validate --family module
yarn harness:validate --all
```

Use a new disposable target per writable run. After a passing oracle, run target `yarn generate`, `yarn typecheck`, `yarn lint`, and `yarn build`, then isolated generated-code review. Rerun mandatory safety coverage.

From a fresh controller with pinned skills, finish with:

```bash
yarn install-skills
yarn harness:release --runner claude --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

Require the schema-valid mode-`0600` sanitized release report and every requested lane to pass. The deterministic `--all` gate does not replace the release suite.

### Repository gate

Choose one Docker/local runner per `.ai/docs/agent-instructions.md`, then run `yarn build:packages`, `yarn generate`, the second `yarn build:packages`, `yarn typecheck`, and `yarn test`. Run `yarn build:app` if emitted/template output changes.

## Phasing and Implementation Plan

### Phase 1 — Prove missing-key false acceptance

1. Add the referenced-key/empty-catalog fixture.
2. Record the unchanged oracle's false-positive localization check as sanitized before evidence.
3. Run a fresh OMH-185 Claude attempt when capacity is available and classify it honestly.

### Phase 2 — Add bounded deterministic catalog validation

1. Implement literal module-key and metadata-key extraction.
2. Implement safe bounded locale discovery/parsing.
3. Add base and emitted-sibling resolution plus non-vacuity.
4. Add `module.locale-catalog` and all malformed/security edge tests.

### Phase 3 — Synchronize and certify

1. Tighten OMH-185/review documentation without adding a case ID.
2. Include locale JSON in inert generated-review evidence.
3. Run focused, package, deterministic, related, and mandatory gates.
4. Run fresh writable target validation, generated review, and the full Claude/Sonnet release suite.

Each phase leaves the harness valid; no owner change lands without its failure-first regression.

## Risks and Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Computed keys are legitimate but unverifiable | Medium | Restrict the fixed case to literal module-owned evidence and leave rich dynamic maps to review/future fixtures. | Medium outside OMH-185, low within it. |
| Shared keys are falsely required locally | Medium | Validate only `library.*` and test shared namespace exclusion. | Low. |
| Malicious/huge JSON consumes resources or abuses prototypes | High | Safe paths, file/count/total-byte caps, plain-object/own-property traversal, dangerous-segment rejection. | Low. |
| Non-English values are present but poor translations | Low | Check presence only; generated/human review owns language quality. | Medium by design. |
| Stricter check lowers runner pass rate | Medium | Treat semantic failures as defects; preserve timeouts and never substitute unavailable requested lanes. | Medium. |
| A new dependency expands standalone surface | Low | Implement with existing TypeScript/JSON facilities; add no dependency. | Low. |

### Rollback

Revert key extraction, catalog parsing/check, focused tests, and synchronized prose together. Preserve OMH-185 and existing validator IDs. A legitimate false positive requires a failing fixture before narrowing the check.

## Migration and Backward Compatibility

No runtime migration. No public import, i18n runtime signature, route, event, ACL/DI ID, database schema, or generated bootstrap registry changes. `module.locale-catalog` is additive and the existing harness result shape remains stable.

## Final Compliance Report — 2026-07-31

| Rule source | Status | Notes |
|---|---|---|
| Root AGENTS.md standalone-harness routing | Compliant | Uses failure-first evolve/refresh and full release contracts. |
| Root/UI AGENTS.md i18n rules | Compliant | Proves module-owned referenced keys exist in emitted catalogs. |
| create-app AGENTS.md standalone parity | Compliant | Requires fresh emitted controller and disposable target validation. |
| om-evolve-harness one-owner rule | Compliant | `writable-ast-oracles.mjs` is the sole primary owner. |
| Secrets/trust boundary | Compliant | Offline parsing, bounded inputs, safe paths, sanitized diagnostics. |
| BACKWARD_COMPATIBILITY.md | Compliant | No stable runtime/generated registry surface changes. |
| Scope cohesion | Compliant | This spec owns only locale-catalog completeness; list UI enforcement was split out. |

**Verdict:** Implementation is complete and repository CI is green. Merge readiness remains blocked until the fresh OMH-185 writable/generated-review evidence and the full Claude/Sonnet release suite required by this spec pass.

## Changelog

- 2026-07-31: Split from the combined UI/i18n draft after mandatory fresh-context scope review; defined OMH-185 locale-catalog completeness.
- 2026-07-31: Implemented the bounded `module.locale-catalog` oracle, focused failure-first and safety coverage, and generated-review guidance on PR #4757. Full fresh-controller release certification remains pending.

### Review — 2026-07-31

- **Reviewer:** Agent plus mandatory fresh-context scope reviewer
- **Security:** Passed with safe-path, bounded-input, and prototype-safe traversal requirements.
- **Performance:** Passed with file-count, per-file, and total-byte caps.
- **Cache/Commands/Data:** N/A; no runtime behavior or persistence changes.
- **Risks:** Passed with dynamic/shared-key and language-quality boundaries explicit.
- **Verdict:** Approved after split; fresh-context per-file scope recheck passed.
