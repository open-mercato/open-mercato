# Standalone Harness Refresh

- Outcome: dry-run
- Local range: `1566a1582b60..5990cf71c438`
- Catalog before/after: `239` / `239`
- External systems mutated: none
- Harness catalog, knowledge owners, schemas, validators, and release matrix edited: none
- Primary live runner: not selected; portability runner: not requested

## Evidence and classification

The supplied local refs resolved to commits and passed the ancestor check. The worktree was clean at audit start. Inspection covered all 20 changed paths in the range; generated build output was inspected after the final build published its staging tree atomically.

| Candidate | Classes | Risk | Repository-relative evidence | Contract/ID summary |
|---|---|---|---|---|
| C1: assistant policy guidance | Module, regression/safety, documentation | Low | `packages/core/src/modules/{customers,catalog}/AGENTS.md`; `customers/ai-tools.ts`; `customers/__tests__/ai-agents.test.ts` | Corrects guidance to existing `confirm-required` defaults and downgrade-only tenant policy; preserves read-only `catalog.catalog_assistant` and every runtime definition/ID. |
| C2: Sales detail widget hosts | UMES extension, installed public contract, UI/UX, testing | Medium | `packages/core/src/modules/sales/extension-points.ts`; `components/documents/SalesDocumentExtensionSpot.tsx`; `backend/sales/documents/[id]/page.tsx`; their two focused test files | Adds bound patterns `detail:sales.{kind}:stage-bar` and `detail:sales.{kind}:closure`, with `kind` restricted to order/quote and explicit context/data/scope/runtime contracts. These are render-widget hosts, not native stage or closure mutation handlers. |
| C3: quote response enrichment | Module, UMES extension, installed public contract, regression/safety, testing/generator | Medium | `packages/core/src/modules/sales/api/documents/factory.ts`; `api/{orders,quotes}/route.ts`; `api/__tests__/{documents.factory,documents.response-enrichment}.test.ts`; `packages/cli/src/lib/generators/__tests__/module-extension-activations.test.ts` | Enables the existing shared enricher runner for `sales:sales_quote`, preserves `sales:sales_order`, and makes both live HTTP opt-ins statically discoverable. No extractor redesign or new runner. |
| C4: specifications and consumer guidance | Installed public contract, documentation | Low | `.ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md`; `.ai/specs/implemented/SPEC-041d-response-enrichers.md`; `UPGRADE_NOTES.md`; `apps/docs/docs/framework/modules/sales/injection.mdx` | Documents actual host placement, guarded app-owned writes, additive response behavior, and quote/order isolation. |
| C5: execution record | Testing/generator, evidence-only | Low | `.ai/runs/2026-10-22-sales-umes-hosts-quote-enrichment.md` | Local implementation and validation tracking; no installed harness contract. |

## Deduplication

| Candidate | Disposition | Existing/new case | Rationale |
|---|---|---|---|
| C1 | evidence-only/no evaluation | OMH-056, OMH-089 are relevant existing routing cases | Installed guidance now agrees with existing runtime and module tests. No new agent ID, override domain, policy value, or harness decision rule is introduced. These routing cases are not themselves runtime mutation-policy tests. |
| C2 | covered | OMH-088; adjacent OMH-027/030 | OMH-088 already requires facts-first exact/pattern resolution, bound hosts, context/provenance, and correlated round-trip verification. The new module-owned patterns are generated data for that procedure. DataTable/component cases are adjacent evidence, not substitutes for these detail-widget hosts. New runtime mount tests cover the actual Sales call sites. A separate model case for each spot would duplicate the mechanism invariant. |
| C3 | covered | OMH-025, OMH-088, OMH-190 | Existing cases cover scoped batched enrichment, actual host activation, and namespaced additive output. OMH-190 is an implementation case targeting Customers; it does not execute Sales quotes. The range adds actual Sales route/runner regressions and a parameterized source-extraction regression for both shipped HTTP routes. This is the smallest direct coverage for the changed binding, without duplicating the general model scenario. |
| C4 | evidence-only/no evaluation | Same existing cases as C2/C3 | The documents describe the same implemented contracts and introduce no separate mechanism. OMH-076/077 remain business-domain neighbors, not exact tests of these host/enricher repairs. |
| C5 | evidence-only/no evaluation | None | Execution evidence does not create a standalone capability or knowledge rule. |

No new catalog case or authoritative harness rule is justified by the observed range. If a future live scaffold run demonstrates a distinct routing or implementation failure, reproduce that failure and expand the smallest existing case before creating another one.

## Failure-first and owners

| Case or surface | Sanitized before evidence | One primary owner | Result after change |
|---|---|---|---|
| Assistant guidance | Base Customers/Catalog instructions described write-capable assistants as read-only and suggested tenant escalation. | Nearest installed module `AGENTS.md` | Instructions agree with runtime definitions. Existing focused module tests pass; no harness owner was edited. |
| Sales host discovery | Both new host patterns are absent from the base `sales/extension-points.ts`. | `packages/core/src/modules/sales/extension-points.ts` and its real mounted helper/page | Both patterns occur exactly once in each final facts sidecar, `resolution: pattern`, `bound: true`, with the kind regex and all four contracts. |
| Sales enrichment activation | Base document factory excluded quote enrichment. An intermediate build with only the shared factory change emitted zero Sales response-enricher activations because the factory parameter was not statically resolved. | Live `packages/core/src/modules/sales/api/{orders,quotes}/route.ts` opt-ins | Explicit live endpoint options let the unchanged extractor emit one response activation per entity, each traced to its route at line 18. The added CLI regression inspects the shipped Sales source. |

This dry-run did not run a model against a base checkout or edit any harness owner. The observations above are source/generated-fact comparisons, not fabricated fail-before/pass-after model evaluations or full release certification.

## Synchronized surfaces

| Catalog/schema/matrix/spec/doc/test surface | Before | After |
|---|---|---|
| `cases.json` | 239 cases | 239 cases; identical SHA-256 `7e7a8f0cb16e610604b6c06511b818e31c34fe8872327db7095b621ac227ae09` |
| Case schema, validators, release matrix | Existing source assets | Unchanged across the resolved range |
| Generated v1/v2 Sales hosts | New patterns absent from base source | Both patterns bound; order/quote parameter constraints and context/data/scope/runtime contracts retained |
| Generated Sales response activations | Intermediate factory-only build: zero | Final build: exactly `sales:sales_order` and `sales:sales_quote`, each linked to the real HTTP route |
| CLI/create-app generated facts | Independently built projections | Both packages have byte-identical v1 facts and byte-identical v2 facts |
| Specs, public docs, compatibility notes | Advertised hosts and quote limitation | Updated to actual implemented mounts and additive quote activation |
| Platform regression coverage | Existing policy, widget, CRUD, and extraction tests | Adds real Sales page/widget mounts, route/runner enrichment, and shipped-source activation assertions; catalog unchanged |

Generated artifact SHA-256:

- `packages/create-app/dist/agentic/guides/module-facts.json`: `23c40067a16b8212c55a2b348d696f5b0b441b9989b81fce5ced8dbccda69cfc`
- `packages/create-app/dist/agentic/guides/module-facts.v2.json`: `0714b89d4d4c72cf13116ddf55fea9f9d8d7a32718e8534417ac214af1613783`
- The corresponding files under `packages/cli/dist/agentic/guides/` have those same respective hashes.

## Validation

Runner: local; Node `v24.19.0`, Yarn `4.17.1`, create-mercato-app/core source version `0.10.0`. No provider-backed model was invoked.

| Command/lane | Runner/model/version | Result | Sanitized artifact or limitation |
|---|---|---|---|
| Final coordinator `yarn generate` then `yarn build:packages` | Local; Node/Yarn above | Build log ends with 39 successful tasks | Final create-app atomic publication observed before facts assertions; unrelated existing non-static search warnings remain. |
| Focused generated-fact assertions | Local Python assertions | PASS | Both packages, both sidecars: exact host count/bound state/parameters/contracts and exact quote/order activation count/source/line verified. |
| `node --import tsx --test --test-name-pattern='deterministic evaluation passes every concrete catalog case in an emitted-layout fixture' packages/create-app/src/lib/agent-harness-evaluator.test.ts` | Local; no model | PASS: 1 selected test, 0 failures/skips | Existing emitted-layout fixture runs the evaluator against all 239 cases. This is deterministic catalog validation, not live routing or app runtime evidence. |
| `node --import tsx --test --test-name-pattern='build emits customers facts and the framework extension catalog|fresh scaffolds receive the disabled local-reference projection' packages/create-app/src/lib/module-facts-build.test.ts` | Local; no model | PASS: 2 selected tests, 0 failures/skips | Checks emitted facts and a newly scaffolded reference projection from the built CLI. Not a packed-framework installation or application end-to-end test. |
| Deterministic `yarn harness:validate --all` in a fresh installed controller | Not selected | Not run directly | The existing evaluator fixture above supplies the 239-case deterministic result; no standalone installed-controller result is claimed. |
| Focused live model cases | No primary runner selected | Not run | Dry-run audit; no provider authentication, model calls, or writable model targets requested. |
| Full `yarn harness:release --runner <codex-or-claude> --prepare-targets <empty-target-directory> --acknowledge-writes` | No primary runner selected; portability not requested | Not run | Dry-run scope. No release-suite report/hash exists, and no release certification is claimed. |

## Blockers or evidence-only decisions

- The intermediate missing quote activation is resolved in final emitted facts by real static HTTP options and covered by a shipped-source extraction regression. It is not an outstanding extractor blocker.
- No distinct harness defect or missing mechanism rule was reproduced. Do not add prose, a model case, or a new teaching module merely because a domain now has another bound host.
- Full packed standalone runtime, live-routing, writable-model, and release-certification lanes remain unexecuted by this audit. Their omission is an explicit dry-run limit, not a pass.
- No lesson, catalog, skill, owner, matrix, generated file, spec, or public document was edited by this audit. Only this sanitized report was written.

## Sanitization attestation

No raw diff, commit/PR body, private prompt/transcript, credential, token, environment value, absolute path, remote URL, or author identity is included.
