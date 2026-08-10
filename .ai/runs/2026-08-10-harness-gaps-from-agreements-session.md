# Harness gaps found by the `agreements-signing-session` run

**Date:** 2026-08-10
**Slug:** `harness-gaps-from-agreements-session`
**Branch:** `fix/harness-gaps-from-agreements-session`
**Stacked on:** `feat/implement-standalone-canonical-example` (PR #4897) — the session ran against the
standalone harness that PR ships, so the fixes must land on top of it, not on `develop`.
**Evidence:** issue #5165 (`Harness session report: agreements-signing-session`) and its public artifacts
on branch `session-share-agreements-signing-session` — `session.json` (12 turns, Codex CLI, OpenAI
provider), `manifest.json`, `privacy-report.json`.

## Goal

Close the harness knowledge and tooling gaps that the agreements-signing session actually tripped over,
with the smallest change that makes each failure impossible to repeat — not a general harness rewrite.

## What went wrong in the session (each finding is reproduced from the transcript)

| # | Failure | Evidence in the session | Owner |
|---|---|---|---|
| 1 | Sidebar icons silently missing on every new page | `page.meta.ts` created with `icon: 'file-signature'`, `'file-plus'`, `'file-edit'`; none of the three exist in the shipped `LUCIDE_ICON_REGISTRY`. Two were later changed to `file-text` during self-review; `file-edit` was never fixed and still renders no icon. This is the defect the user reported with a screenshot mid-session. | `.ai/guides/backend-ui.md`, `om-backend-ui-design/references/page-and-navigation.md` |
| 2 | `CommandBus.execute()` result shape | The envelope route treated the bus return value as the payload and called `.map()` on `undefined`; the user hit a broken "Create signing links" button in the browser. `execute()` resolves `{ result, logEntry }` (`packages/shared/src/lib/commands/types.ts:82`). The harness never mentions `commandBus` at all. | `om-module-scaffold/references/api-and-domain.md` |
| 3 | `createOrmEntity` demanded `createdAt` / `updatedAt` | Three typecheck cycles lost to `Property 'createdAt' is missing`. Root cause: entity timestamp columns declared as `createdAt!: Date` instead of the canonical example's `createdAt: Date = new Date()`, which is what keeps them optional in the derived data type. | `om-data-model-design/references/schema-design.md` |
| 4 | Stale generated registry vs. a running dev server | `POST /api/agreements/agreements` 500 in `DefaultDataEngine.createOrmEntity`. The user pasted the stack; the agent spent a full turn on ORM probes (all of which failed for unrelated reasons) before finding that the dev server had bootstrapped before `yarn generate` ran. A restart fixed it. | `.ai/guides/testing-debugging.md` |
| 5 | Ad-hoc `yarn tsx -e` runtime probes cannot work | Three consecutive failures: top-level await under CJS, then `[Bootstrap] DI registrars not registered` twice, including after importing `./src/bootstrap-api`. The guide tells agents to "reproduce with the smallest stable command" without naming a bootstrap-safe one. | `.ai/guides/testing-debugging.md` |
| 6 | App-owned command tests cannot even load | `yarn test src/modules/agreements/commands/__tests__/agreements.test.ts` died on `SyntaxError: Cannot use 'import.meta' outside a module` from `@mikro-orm/core`. The monorepo solved this with `scripts/jest-mikroorm-transformer.cjs`; the scaffold template's `jest.config.cjs` still uses bare `ts-jest`, so **every** command/entity test the harness instructs an agent to write is unrunnable in a standalone app. | `packages/create-app/template/jest.config.cjs` |
| 7 | `om-share-this-session` dead-ended twice | Two turns produced "the current session does not expose a native JSON export path". The user had to intervene; the agent then found Codex's own `app-server` `thread/read` API, which is a first-party call, not the profile crawling the skill forbids. | `om-share-this-session/references/bundle-preparation.md` |
| 8 | Privacy sanitizer misclassifies migration timestamps | The published bundle contains `Migration«redacted:phone»_agreements.ts`. The phone rule `/\+?\d[\d ()-]{7,}\d/g` has no left boundary, so any long digit run inside an identifier is redacted as a phone number. Over-redaction is not a privacy risk but it destroys the evidence the bundle exists to carry. | `om-share-this-session/scripts/prepare-share-bundle.mjs` |

Findings 1–5 are knowledge gaps: the agent behaved reasonably given what the harness told it. Finding 6
is a real tooling defect. Findings 7–8 are the harness's own reported weaknesses, quoted in #5165.

## Scope

- Knowledge edits confined to the guide/reference that already owns each subject; rewrite existing
  sentences rather than appending, because live harness cases meter context bytes.
- One template code fix (the Jest transformer) plus its regression test.
- Two `om-share-this-session` fixes: the missing export path and the phone-boundary regression.

## Non-goals

- No changes to the agreements module itself; it lives in the user's app, not this repository.
- No fix for the `crm`/`empty` preset missing `search` (#5164) or the `search.global`/`search.view` gate
  mismatch (#5163) — separate issues, separate owners, not harness knowledge.
- No new harness cases (`cases.json`) — case authoring is `om-evolve-harness` work and would widen this
  change well past "minimal".
- No attempt to reclassify "unrelated browser-tab history" from the privacy report: the artifact does not
  identify which file was misclassified, and guessing a rule would be worse than leaving it reported.
- No change to `AGENTS.md.template`; its 12 KiB budget is the scarcest resource in the harness and every
  finding here has a routed owner further down the chain.

## Risks

- **Context budgets.** Live harness cases cap the bytes an agent may load. Every edit either replaces text
  or adds a single clause; net growth is measured before commit and reported.
- **Jest transformer port.** The monorepo transformer also aliases `typescript` → `typescript-js`, which
  standalone apps do not install. That redirect must not be copied.
- **Phone-rule narrowing.** Adding a left/right boundary means a phone number glued to a word is no longer
  redacted. The mandatory semantic-review gate still covers that case, and the alternative — unreadable
  migration filenames in every shared bundle — is the more likely harm.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Plan

- [x] 1.1 Record the session analysis and the change set as this execution plan — c0850c4ae

### Phase 2: Knowledge fixes

- [x] 2.1 Icon strings must resolve in the shipped registry (backend-ui guide + page-and-navigation) — 6c9075122
- [x] 2.2 `commandBus.execute()` returns `{ result, logEntry }` (api-and-domain) — 6c9075122
- [x] 2.3 Entity timestamp columns need initializers so `createOrmEntity` stays assignable (schema-design) — 6c9075122
- [x] 2.4 Stale-registry restart rule and the bootstrap-safe probe path (testing-debugging) — 6c9075122

### Phase 3: Scaffold test runner

- [x] 3.1 Ship the `import.meta` Jest transformer in the template and point `jest.config.cjs` at it — adccccb0c
- [x] 3.2 Regression test pinning the transformer wiring and its sanitization — adccccb0c

### Phase 4: Session sharing

- [x] 4.1 Document the Codex `app-server` `thread/read` export path in bundle-preparation — b2857fc51
- [x] 4.2 Bound the phone rule so identifiers are not redacted as phone numbers, with a test — b2857fc51

### Phase 5: Validation and delivery

- [ ] 5.1 Run the validation gate and report byte deltas against the harness budgets
