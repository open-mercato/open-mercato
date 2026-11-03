---
title: "Standardize record-not-found as a dedicated page state in backend UI"
modules: ["ui","auth","customers","sales","audit_logs","shared"]
areas: ["backend-ui","debugging","module-data","testing"]
topics: ["error-states","ui-components","i18n","command-pattern"]
---

# Standardize record-not-found as a dedicated page state in backend UI

**Context**: Record-backed backend pages evolved with mixed missing-record patterns. Some pages used `ErrorMessage`, some rendered custom centered `<div>` markup with plain text and a button, and some collapsed `notFound` and generic load failures into the same branch.

**Problem**: The UX became inconsistent across products, customers, auth, resources, sales, and similar modules. In some pages the missing-record path still lived too close to the form/detail rendering path, making it easy to keep rendering page chrome or controls when the record was gone.

**Rule**: For any record-backed backend detail or edit page, model `notFound` as a dedicated page state separate from generic `error`. When the requested record does not exist, return early and render a page-level state built on `ErrorMessage`, with a clear recovery action such as "Back to list". Do not render `CrudForm`, detail sections, tabs, or record actions in the not-found branch.

**Command-boundary evidence (#8033)**: A record can also disappear between an initial read and a transaction's locked refresh. The new sales-delete refusal returned an English literal even when audit replay translated domain-error keys: `translateCrudErrorBody` treats the supplied text as the key and fallback, so it cannot infer a translation for that literal. Resolve an existing module locale key before constructing the 404, preserving the lock, status, rollback, and cascade ordering. Exercise the real command handler with the locked lookup returning null and an actual non-English dictionary; assert the localized body and that no deletion or side effect occurs.

**Applies to**: `packages/ui`, `packages/ui/src/backend`, any backend `[id]` page in `packages/core/src/modules/**/backend/**`, and command branches that report a record disappearing during a locked refresh.
