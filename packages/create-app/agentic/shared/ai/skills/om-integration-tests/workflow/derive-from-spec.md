# Derive Test Cases from a Spec

When reading a spec, extract test scenarios from these sections:

| Spec Section | Generates |
|-------------|-----------|
| API Contracts — each endpoint | One API test per endpoint (CRUD) |
| UI/UX — each user flow | One UI test per flow |
| Edge Cases / Error Scenarios | One test per significant error path |
| Risks & Impact Review | Regression tests for documented failure modes |

Typical spec produces 3-8 test cases. Prioritize:
1. **High**: CRUD happy paths, authentication, authorization
2. **Medium**: Validation errors, edge cases with business impact
3. **Low**: Cosmetic, minor UX edge cases

## Example

Given a spec for an Inventory Management module, the skill would produce:

- `src/modules/inventory/__integration__/TC-INV-001.spec.ts` — UI: create and list inventory items
- `src/modules/inventory/__integration__/TC-INV-002.spec.ts` — API: CRUD operations on inventory items
- `src/modules/inventory/__integration__/TC-INV-003.spec.ts` — UI: validation errors on create form
- Optionally: matching `.ai/qa/scenarios/TC-INV-001-*.md` files for documentation

Feed each derived scenario into the [`author-test.md`](author-test.md) phases, discovering the actual locators and payloads via Playwright MCP before writing each `.spec.ts`.
