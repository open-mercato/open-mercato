# Omit low-value customer vectors

Source doc: .ai/specs/2026-11-21-customer-vector-semantics.md ([design PR #10223](https://github.com/open-mercato/open-mercato/pull/10223))
Issue: [#8135](https://github.com/open-mercato/open-mercato/issues/8135)
Status: in-progress

Keep fulltext and token lookup for customer users and person/company profiles. Use the existing entity strategy policy to omit built-in vectors while preserving the source privacy and presentation contract.

## Progress

### Phase 1 · Verify and apply the registration policy

- [x] 1.1 Characterize the existing provider and storage behavior. All 100 tests in `vector-index-security.test.ts` and `reindex-strategy-policy.test.ts` passed on upstream baseline `56d0700f9b`.
- [x] 1.2 Apply and test the strategy policy across indexing and reindex paths. `bd4459f4d4` adds the three strategy overrides and provider-boundary coverage.
- [ ] 1.3 Verify lexical lookup and vector pagination integration coverage. Document the scoped purge and rollback.
- [ ] 1.4 Archive the capability delta and run the repository validation and review gates.
