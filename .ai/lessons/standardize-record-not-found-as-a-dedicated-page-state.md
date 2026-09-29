---
title: "Standardize record-not-found as a dedicated page state in backend UI"
modules: ["ui","auth","customers"]
areas: ["backend-ui","debugging"]
topics: ["error-states","ui-components"]
---

# Standardize record-not-found as a dedicated page state in backend UI

**Context**: Record-backed backend pages evolved with mixed missing-record patterns. Some pages used `ErrorMessage`, some rendered custom centered `<div>` markup with plain text and a button, and some collapsed `notFound` and generic load failures into the same branch.

**Problem**: The UX became inconsistent across products, customers, auth, resources, sales, and similar modules. In some pages the missing-record path still lived too close to the form/detail rendering path, making it easy to keep rendering page chrome or controls when the record was gone.

**Rule**: For any record-backed backend detail or edit page, model `notFound` as a dedicated page state separate from generic `error`. When the requested record does not exist, return early and render a page-level state built on `ErrorMessage`, with a clear recovery action such as "Back to list". Do not render `CrudForm`, detail sections, tabs, or record actions in the not-found branch.

**Applies to**: `packages/ui`, `packages/ui/src/backend`, and any backend `[id]` page in `packages/core/src/modules/**/backend/**`.
