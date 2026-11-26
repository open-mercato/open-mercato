# Vector-index entity read authorization

Require the vector-index list to respect the same entity view features as search results. The list remains scoped to the caller's tenant and approved organizations. This work addresses #10693.

## Scope

Apply the existing search entity authorization policy to the vector-index list and preserve pagination over readable entries. Keep the API response schema and existing purge behavior. Add automated coverage with synthetic data. The work is confined to backend code and documentation.

## Risks

A change to how the index selects readable types can alter results seen by diagnostic clients. Verify scoped grants, a permitted explicit entity, a denied explicit entity, and mixed listings. Keep the fix open for review and acceptance.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Restrict vector-index reads

- [ ] 1.1 Enforce entity read authorization before pagination and at the response boundary
- [ ] 1.2 Verify permissions and pagination with automated coverage

### Phase 2: Prepare for acceptance

- [ ] 2.1 Run validation and review the PR
