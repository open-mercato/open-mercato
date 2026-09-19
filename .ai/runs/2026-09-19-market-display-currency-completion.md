# Market display currency completion

Source doc: .ai/specs/2026-09-18-market-display-profile.md

## Goal

Make the company-detail monetary KPIs denomination-safe and profile-aware so a US organization no longer sees a fabricated PLN fallback, while preserving explicit stored currencies and the existing API contract.

## Scope

- Audit the tracked OSS currency display surface and record a bounded disposition artifact for the amendment.
- Add complete, tenant-scoped active/won deal subtotals grouped by currency to the company detail API.
- Migrate the reported company KPI path and customer-detail money consumers to the existing market-profile formatter.
- Add regression tests, OpenAPI/type coverage, translations, and compatibility guidance.

## Non-goals

- No currency conversion, stored-currency rewrite, seed rerun, migration, or production-data mutation.
- No enterprise or external official-module edits.
- Amendment Phase C2 (all remaining OSS money consumers and the lint guard) is the explicitly deferred long-tail wave and is not part of this hackathon happy-path run.
- No unrelated date, address, tax, measurement, or market-profile foundation work.

## Implementation Plan

### Phase 1: Audit and contracts

1. Reproduce with deterministic fixtures when the reported remote company is inaccessible, audit tracked OSS currency consumers, and record each relevant file as migrated, compliant, exempt, or externally owned.
2. Add additive grouped KPI response fields, OpenAPI/types, compatibility guidance, and scoped API regressions covering mixed currencies, unknown denominations, invalid amounts, and full aggregation beyond the preview.

### Phase 2: Reported company path

3. Migrate `CompanyKpiBar`, `ActiveDealCard`, and all first-party callers of the customer detail currency helper to the existing profile-aware money formatter without changing legacy helper behavior.
4. Add component/helper regressions and translated empty, mixed, unknown, and incomplete states; verify the reported company route with deterministic US fixtures.

### Phase 3: Verification and review

5. Run the configured validation gate, complete the authoritative autofix review loop, and capture live UI evidence for the company detail tile.

### Deferred long-tail wave

- [ ] C2.4 Migrate every remaining non-exempt OSS money consumer. — Deferred by the run brief: amendment Phase C2 is the post-hackathon long tail.
- [ ] C2.5 Complete public/portal, widget, preview, email, PDF, and human-export coverage. — Deferred by the run brief.
- [ ] C2.6 Add the narrow money-format lint guard and close the repository-wide inventory. — Deferred by the run brief.

## Risks

- Existing scalar KPI fields are unsafe for mixed currencies; they remain only as a deprecated compatibility bridge while new UI consumes grouped totals.
- A display profile must never relabel an explicit stored currency. Tests cover explicit PLN under a US profile.
- The upstream target does not yet contain the fork's market-profile runtime prerequisites; the implementation uses the configured fork `develop` baseline and the PR will disclose that dependency.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and contracts

- [ ] 1.1 Audit and record currency consumer dispositions
- [ ] 1.2 Add grouped KPI API contract and regression coverage

### Phase 2: Reported company path

- [ ] 2.1 Migrate customer detail money consumers to profile-aware formatting
- [ ] 2.2 Add UI/helper regressions and deterministic route verification

### Phase 3: Verification and review

- [ ] 3.1 Run the full gate, autofix review, and UI evidence pass
