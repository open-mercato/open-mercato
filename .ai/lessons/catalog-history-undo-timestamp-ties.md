---
title: "Handle timestamp ties when filtering undone price history"
modules: ["catalog"]
areas: ["module-data","testing"]
topics: ["undo-redo","data-integrity","timestamp-ordering"]
---

# Handle timestamp ties when filtering undone price history

Review of #6419 found that the Omnibus history anti-join ignored an undo when it shared the original creation timestamp. The real PostgreSQL regression returned the undone 5 price instead of the valid 100 reference. Application timestamps have millisecond precision; distinct change types can share a timestamp without violating history idempotency.

Test equal-time originals and restored lifecycles before treating a timestamp comparison as event ordering. For create-undo filtering, cancel the original non-redo creation at equality while preserving a restored creation identified by `redoneCommand`. A blanket strict-to-inclusive comparison also cancels valid same-time redos. Cover both baseline and in-window selection, historical cutoffs, repeated undo/redo, and tenant/organization isolation with the real query.
