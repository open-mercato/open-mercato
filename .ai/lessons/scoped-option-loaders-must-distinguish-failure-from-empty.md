---
title: "Scoped option loaders must distinguish failure from empty results"
modules: ["customer_accounts","ui"]
areas: ["backend-ui","testing"]
topics: ["error-states","data-scoping","ui-components"]
---

# Scoped option loaders must distinguish failure from empty results

**Evidence**: [QA on #8470](https://github.com/open-mercato/open-mercato/pull/8470#issuecomment-6576565839) returned HTTP 500 for the create-user dialog's target-organization roles request. The loader converted that failure to an empty list, hiding the role picker without an error or recovery action. Successful creation and server-side organization validation still worked, so happy-path coverage did not expose the defect.

**Rule**: Keep loading, failed, valid-empty and loaded option states distinct. Render the shared loading/error components and a localized retry for failures. Store the request's organization with its result and render options only when that organization still matches the current selection; ignore late successes and failures after a scope change. Retry the current scope without resetting entered form values.

**Verification**: Exercise HTTP and transport failures, malformed success payloads, retry recovery with form-value preservation, valid empty results, and a delayed failure after switching organizations. Browser evidence must confirm that the failure is visible and actionable; a successful create alone is insufficient.
