# Standalone Harness Refresh

- Outcome: blocked
- Local range: `586171ad2158..4af9150ced77`
- Catalog before/after: `213` / `214`
- External systems mutated: none

## Evidence and classification

| Candidate | Classes | Risk | Repository-relative evidence | Contract/ID summary |
|---|---|---|---|---|
| DOC-001 | Module, installed public contract, UI/UX, regression/safety | High | `packages/documents/src/modules/documents/**`, `.ai/specs/2026-07-08-documents-collaborative-editor.md` | New installed `documents` module, `documents.*` ACL/API/event surfaces, per-document access, collaboration, comments, versions, templates, attachments, and record links. |
| DOC-002 | UMES extension | Medium | `packages/documents/src/modules/documents/widgets/injection-table.ts`, generated `documents` module facts | Related-document contributions and notification registrations use existing fact-first UMES coverage. |
| DOC-003 | Testing/generator | High | `packages/create-app/template/src/modules.ts`, `packages/create-app/src/lib/module-facts-build.test.ts` | The scaffold ships `.ai/guides/modules/documents.md`, but no catalog case required it before this refresh. |

## Deduplication

| Candidate | Disposition | Existing/new case | Rationale |
|---|---|---|---|
| DOC-001 | Add | OMH-214 | Choosing the installed collaborative-document capability, including its record-level access posture, is distinct from existing messaging, audit, and generic reuse-installed cases. |
| DOC-002 | Covered | OMH-088, OMH-089 | Existing additive-extension and override audits already resolve contributed hosts, notifications, and stable fact references. |
| DOC-003 | Add | OMH-214 | A required module-fact read is necessary to make emitted fact coverage executable rather than merely available. |

## Failure-first and owners

| Case | Sanitized failure before owner edit | One primary owner | Result after edit |
|---|---|---|---|
| OMH-214 | The create-app guard rejected the shipped `documents` fact sheet because no evaluation required it. | Generated facts: `.ai/guides/modules/documents.md` | The catalog now requires the generated fact and the complete create-app package test passes. No generated owner content was hand-edited. |

## Synchronized surfaces

| Catalog/schema/matrix/spec/doc/test surface | Before | After |
|---|---|---|
| Case catalog and schema | 213 cases, maximum OMH-213 | 214 cases, maximum OMH-214 |
| Validator registry | Expected 213 | Expected 214 |
| Release matrix | 46 writable/portability cases | Unchanged; OMH-214 is read-only routing coverage |
| Harness specification and docs | Stale current totals | Current totals and OMH-204–214 use-case list synchronized |
| Focused guards | No Documents-specific catalog assertion | OMH-214 context and decision assertions plus emitted-fact coverage |
| Lesson owner | General standalone synchronization rule | Explicit required-context rule for every newly shipped module fact |

## Validation

| Command/lane | Runner/model/version | Result | Sanitized artifact or reason unavailable |
|---|---|---|---|
| `yarn workspace create-mercato-app build` | Local Node/Yarn | Pass | Emitted 56 module fact sheets. |
| `yarn workspace create-mercato-app test` | Local Node test runner | Pass | 460 passed, 5 platform skips, 0 failed; deterministic 214-case catalog and emitted-fact coverage passed. |
| Focused OMH-214 live routing | Not run | Unavailable | The repository CI fix requires deterministic coverage; no provider-backed release evidence was claimed. |
| `yarn harness:validate --all` from a fresh scaffold | Local deterministic equivalent | Pass | The create-app package test ran the emitted-layout deterministic all-case gate. |
| Full `yarn harness:release --runner codex --prepare-targets <absolute-empty-dir> --acknowledge-writes` | Primary runner: not run; portability runner: not requested | Blocked | The complete suite requires Linux with trusted Bubblewrap; the current host is macOS. Existing release certification remains separate from this focused CI remediation. |

## Blockers or evidence-only decisions

- Complete standalone-harness release certification cannot run on this macOS host because the required loopback-isolated Linux/Bubblewrap containment is unavailable. This does not weaken or waive the deterministic CI gate.

## Sanitization attestation

No raw diff, commit/PR body, private prompt/transcript, credential, token, environment value, absolute path, remote URL, or author identity is included.
