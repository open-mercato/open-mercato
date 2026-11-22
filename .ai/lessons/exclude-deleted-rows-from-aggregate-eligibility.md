---
title: "Exclude deleted rows from aggregate eligibility decisions"
modules: ["sales"]
areas: ["module-data", "testing"]
topics: ["soft-delete", "aggregate-validation", "workflow-guards", "testing"]
---

# Exclude deleted rows from aggregate eligibility decisions

A parent command's child map may intentionally include historical rows for legacy validation. A new aggregate decision must explicitly select its live population: a fully returned active order was incorrectly considered shippable because a deleted, unreturned positive line made `every(...)` false.

Filter deleted rows before computing aggregate eligibility, without silently changing the legacy population used by other validations. Include mixed live/history fixtures: one fully returned active line plus one deleted unreturned line must still refuse a new shipment. Evidence: `sales/commands/shipments.ts` and `sales/commands/__tests__/document-workflow-guards.test.ts`.
