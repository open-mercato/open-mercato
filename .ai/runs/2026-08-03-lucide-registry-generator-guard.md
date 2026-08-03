# Lucide registry generator guard

## Goal

Make the versioned Lucide icon registry a reproducible generator output instead of a recurring merge-repair surface. Framework icon literals must be discovered through one shared implementation, local contributors must have explicit sync/check commands, CI must reject committed drift without mutating the tree, and the emitted standalone harness must steer agents away from editing installed generated files.

## Scope

- Extract icon discovery, Lucide export resolution, source generation, sync, and parity checking from the UI build entrypoint into one reusable generator module.
- Keep the UI package build regenerating the committed registry through that shared module.
- Add root-level `lucide:sync` and non-writing `lucide:check` commands and run the check in CI.
- Add unit and real-repository parity coverage, including an actionable failure for stale generated output.
- Add one standalone-harness regression case and one smallest documentation owner for installed-registry guidance.

## Non-goals

- Changing the public icon resolver API or the generated registry shape.
- Making the committed registry ephemeral; clean clones must retain the versioned generated source.
- Teaching downstream standalone apps to run framework-monorepo generation commands.
- Broadening icon discovery beyond serializable `icon:` metadata and string icon props.

## Compatibility and risk

- The generated module remains committed and keeps the same exports and runtime representation.
- The new checker is read-only and fails only when the committed source differs from the shared generator's deterministic output.
- Build behavior remains compatible because it invokes the same generator before packaging.
- Harness changes are additive: one routing case plus a focused clarification in the existing backend UI guide.

## Verification

- Run generator unit tests and the repository-wide guard suite.
- Prove the harness case fails before its owner is updated, then passes after the owner change.
- Run the harness deterministic validation and affected create-app tests.
- Run every configured repository validation command in order.
- Review the complete branch diff against `BACKWARD_COMPATIBILITY.md` and the repository review checklist.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared generator lifecycle

- [x] 1.1 Extract repository discovery and deterministic generation into one reusable module — cf137956b
- [x] 1.2 Add explicit sync and non-writing parity-check commands — cf137956b
- [x] 1.3 Keep the UI build wired to the shared generator — cf137956b

### Phase 2: Drift prevention

- [ ] 2.1 Add failure-first unit and real-repository parity coverage
- [ ] 2.2 Enforce Lucide registry parity in repository CI

### Phase 3: Standalone harness guidance

- [ ] 3.1 Add a failure-first harness case for generated registry ownership
- [ ] 3.2 Update the single backend UI guide owner and restore the case
- [ ] 3.3 Validate emitted harness parity and deterministic catalog coverage

### Phase 4: Release readiness

- [ ] 4.1 Run the full configured validation gate
- [ ] 4.2 Complete code review and compatibility review
