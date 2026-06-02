# Notify — 2026-05-27-crm-sales-catalog-audit

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T10:30:00Z — run started
- Brief: Analyze CRM (`customers`), `sales`, `catalog` for inter-module references, security holes, race conditions, DRY violations; create GH issues; fix the first one in a PR.
- External skill URLs: none.
- Decision: treat "CRM" as the `customers` module (matches `AGENTS.md` reference module designation).
- Working in janitor-managed worktree on existing branch `task/4476d81e-7df9-4d2e-8173-bd7b60e9808b`; not renaming to `fix/` or `feat/` to keep harness intact.

## 2026-05-27T10:35:00Z — audit reports returned (parallel subagents)
- 3 module audits returned: customers (10 findings), sales (10 findings), catalog (10 findings).
- Severity distribution: 1 critical (S-01), 10 high, 16 medium, 3 low. C-05 deduped into C-02.
- Top finding S-01 (cross-tenant payment allocations) selected for this PR.

## 2026-05-27T10:42:00Z — GitHub issues filed
- 10 individual issues for high-severity findings: #2111 (S-02), #2112 (S-03), #2113 (S-04), #2114 (S-05), #2115 (C-01), #2116 (C-02), #2117 (C-03), #2118 (K-01), #2119 (K-02), #2120 (K-03).
- 1 tracking issue #2121 rolls up the 16 medium + 3 low findings.

## 2026-05-27T10:48:00Z — S-01 fix landed locally with tests
- Patched `commands/payments.ts` create and update allocation loops to validate `allocation.orderId` and `allocation.invoiceId` via `findOneWithDecryption(..., { tenantId, organizationId })` + `ensureSameScope` before referencing.
- Added per-loop `orderCache` / `invoiceCache` Maps to avoid re-querying when allocations reference the already-validated main order.
- 5 new unit tests in `commands/__tests__/payments.test.ts`; all 15 tests in the file pass.
- Pre-existing failures in `quotes.acceptance` (14/20), `ShipmentsSection`, `timeline`, `salesDocumentFormCurrency`, `salesComponentsRender` confirmed on `develop` head `636677865` — unrelated.
