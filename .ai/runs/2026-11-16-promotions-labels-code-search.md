# Promotions label entry and generated-code discovery

Status: in-progress
Source doc: .ai/specs/SPEC-055-2026-02-23-promotions-module.md
Issues: #7704, #7712

## Goal

Make a benefit's required buyer-facing label immediately editable and let staff locate a generated promotional code without opening every pool.

## Scope

Existing promotions benefit editor, code list, generated-code modal and their read APIs. Keep writes, permissions, tenant/organization boundaries, code normalization, pagination and optimistic locking intact. No schema, dependencies, new module, provider setup or evaluation changes.

## Implementation plan

### Phase 1: Benefit labels

Show an empty label row in the current supported interface locale when no label exists. Give each input an associated buyer-facing name, explanation and required error. Preserve existing translations and optional additional locale rows.

### Phase 2: Generated-code discovery

Keep name/static-code search and additionally resolve a complete generated code through the existing normalized code resolver. Restrict the resulting parent match to the caller's tenant and organization scope. Include the matched code and its active state on the matched row. Add optional search to the generated-code list and expose it through the modal's DataTable, resetting pagination when the search changes.

### Phase 3: Verification and publication

Add meaningful component, API/filter and self-contained integration regressions for both requests. Update SPEC-055's contracts and coverage. Run the configured validation gate, document genuine environmental blockers, resume the existing independent final-review task (no third child), address findings, and publish one ready PR with review and UI evidence. Never merge or award QA approval.

## Risks and compatibility

Search additions are optional/additive: existing requests and response fields retain their meaning. Generated-code matches must never cross tenant or organization boundaries, including All organizations and empty scopes. A virtual empty label row must not dirty or mutate a saved benefit merely by rendering it. Labels still require at least one nonblank value. Search and locale changes must not discard entered text or apply stale responses.

## Progress

### Phase 1: Benefit labels

- [ ] 1.1 Make the required label immediately accessible with translated field feedback.

### Phase 2: Generated-code discovery

- [ ] 2.1 Add scoped generated-code search and matched-code presentation.
- [ ] 2.2 Add modal search with pagination reset and regression coverage.

### Phase 3: Verification and publication

- [ ] 3.1 Update the spec, run validation and integration/UI checks.
- [ ] 3.2 Obtain independent review, address findings and publish the ready PR.
