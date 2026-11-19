# Notify — 2026-11-19-r5-sa1-quote-external-reference

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-19T22:48:28Z — run started
- Brief: R5 step SA1 — nullable snapshot line fields, quote externalReference/customerReference, (tenant_id, external_reference) indexes on sales_quotes and sales_orders.
- External skill URLs: none

## 2026-11-19T22:48:28Z — decision: proceed without the re-landing plan file
- .ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md was missing from the primary checkout; the user instructed the run to continue autonomously. R1–R14 / card content taken from the brief only.

## 2026-11-19T22:48:28Z — decision: spec over card (R4)
- sales_orders index added (D-R5-CH1); amountsMode made nullable (§14a row 3); index columns (tenant_id, external_reference) per spec, not the audit's 3-column proposal.

## 2026-11-19T23:34:14Z — final gate
- Gate green except the known local-only create-mercato-app harness suites; core re-run alone green; db:generate clean for sales; integration 3/3. Step 1.5 (integration spec) added.

## 2026-11-19T23:36:54Z — run complete
- om-auto-review-pr: document-approvable, posted as a comment review (self-authored PR). One nit: update undo snapshots do not carry the document references (pre-existing).
- PR https://github.com/open-mercato/open-mercato/pull/10033 flipped to ready; labels feature, needs-qa, priority-medium, risk-high, review.
