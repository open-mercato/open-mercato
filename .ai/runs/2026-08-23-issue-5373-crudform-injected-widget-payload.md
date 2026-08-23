# Execution plan — land the injected-CrudForm-payload channel through the outstanding re-review (adopted from PR #5415)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-23 because PR #5415 carried no execution plan (no `Tracking plan:` line, nothing under `.ai/runs/`).
**PR:** #5415 · **Branch:** `feat/issue-5373-crudform-injected-widget-payload` · **Base:** `develop`
**Author:** @Paul-Mlodochowki — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Make the injected-`CrudForm`-field payload reach CRUD `POST`/`PUT` interceptors as `context.extensionPayload` without being remotely abusable, without riding along on requests it was not meant for, and with the documentation and coverage this repository requires — so PR #5415 can be re-reviewed and merged.

## Scope

- `packages/shared/src/lib/umes/extension-payload.ts` — payload sanitation (prototype-key safety, bounded arrays).
- `packages/shared/src/lib/crud/widget-payload.ts`, `factory.ts`, `custom-route-interceptor.ts` — server-side plumbing of the channel.
- `packages/ui/src/backend/utils/apiCall.ts`, `packages/ui/src/backend/CrudForm.tsx` — client-side transport scoping.
- Tests under the same packages, plus API-level integration coverage.
- Docs: `.ai/specs/2026-08-19-crudform-injected-widget-payload.md`, `.ai/specs/implemented/SPEC-041g-crudform-fields.md`, `packages/shared/AGENTS.md`, `packages/ui/AGENTS.md`.

## Non-goals

- Redesigning the transport away from the private `__om_ext_v1` body field onto a header channel. The reviewer explicitly endorsed the `context.extensionPayload` shape at `5b38d0f85`; only its blast radius is in question.
- Building a consumer module for the channel. Browser-level end-to-end coverage of an injected widget needs a real contributing module, which this PR deliberately does not ship (major 3 in the re-review, flagged there as a maintainer waiver candidate).
- Removing the `do-not-merge` hold — that is @adeptofvoltron's call, not this run's.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The remaining work is exactly the re-review's finding list | @pkarw review `5000029136` (2026-08-22) and the handback comment on PR #5415 | high |
| All three blockers from the first review are already fixed | The same re-review's "Previous blockers — verified fixed" table, checked against `5b38d0f85` | high |
| The user's goal for this run is "fix what the code review found" | The `/om-auto-continue-pr` invocation argument | high |
| The `context.extensionPayload` design should be kept | Re-review summary: "the `context.extensionPayload` design is the one to keep" | high |
| Integration coverage is required by repo policy but waivable here | Root `AGENTS.md`, `.ai/qa/AGENTS.md`, and the reviewer's own "I'd accept a maintainer waiver on" note | medium |

## Assumptions

- **The ambient body scope must be narrowed, not removed.** `CrudForm` cannot know its submit URL (`onSubmit` is caller-supplied and the component has no endpoint prop), so an exact request match is not available. The most reversible fix that closes the reported failure modes is to gate the scope to JSON write requests and spend it on the first eligible one, rather than leaving it open across the whole submit.
- **A `.strict()` hand-written route that is itself a CrudForm submit target stays the caller's responsibility.** After the narrowing, the payload reaches only the form's own submit, so this collapses from "any request in the app" to "this form's own endpoint" — documented rather than defended in code.
- **API-level integration coverage satisfies the spirit of major 3.** A browser test needs a consumer module that does not exist; an integration test that drives a real `makeCrudRoute` handler end to end covers the API path the spec introduces.

## Risks

- The single-shot scope changes observable client behavior for any second write inside `onSubmit`; a form that deliberately relied on the payload reaching a secondary write would lose it. No such consumer exists yet, so the risk is theoretical today.
- `packages/shared/AGENTS.md` and `packages/ui/AGENTS.md` are governed by the agent instruction budget (`yarn agents:check-budget`); doc additions there may need to be paid for by trimming.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Expose injected CrudForm field values to CRUD interceptors and fix the first review's three blockers — 5b38d0f85

### Phase 2: Security and sanitation (re-review majors/minors)

- [x] 2.1 Guard module-id keys against prototype pollution in `sanitizeExtensionPayload` and `mergeExtensionPayload`, with null-prototype accumulators and a `getPrototypeOf` regression test (major 1) — b4148f169
- [x] 2.2 Apply the advertised key cap to array-shaped payloads and align the spec wording (minor 4) — b4148f169

### Phase 3: Scope the client transport to the request it belongs to (major 2)

- [x] 3.1 Gate the scoped body injection to JSON write requests and spend the scope on the first eligible request, with tests covering GET pass-through, non-JSON content types, and secondary writes — 5d5469c3c
- [x] 3.2 Update `CrudForm` and the docs for the narrowed contract, including the residual the reviewer must be able to see — 5d5469c3c (no `CrudForm` code change was needed: the component already opens the scope only around `onSubmit`, so narrowing `apiCall` was sufficient; the contract is documented in `widget-injection.md` and the spec)

### Phase 4: Consistency, cleanup and coverage (majors/minors/nits)

- [x] 4.1 Forward `extensionPayload` through `runCustomRouteAfterInterceptors` (nit 7) — f9b349c34
- [x] 4.2 Drop the dead `parsedBody` indirection on both direct branches (minor 6) — f9b349c34
- [x] 4.3 Add the strict-schema regression for the direct create path (nit 8) — f9b349c34
- [x] 4.4 Add API-level integration coverage for the new interceptor surface (major 3) — f9b349c34

### Phase 5: Documentation debt (minor 5)

- [x] 5.1 Qualify the `SPEC-041g` invariant at line 787 and record the new channel in its Phase G status table — f9b349c34
- [x] 5.2 Record the channel in `packages/shared/AGENTS.md` and `packages/ui/AGENTS.md` within the instruction budget — f9b349c34

### Phase 6: Validation and handback

- [ ] 6.1 Run the full validation gate and post the resume summary on the PR
