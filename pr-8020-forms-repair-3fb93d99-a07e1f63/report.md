# Forms repair and latest-base QA — PASS

Head `3fb93d99cb4249962b35fe77c4688604b8983f3c`, including main `970b396ebb71723b722dd8ec074f59050e3fb118`. Four cases passed once, zero skipped/retried.

| Actual case | Result |
|---|---|
| mcp key preserves the owner UserAcl on cold and warm requests | PASS |
| session key preserves the owner UserAcl on cold and warm requests | PASS |
| tenant-wide mcp key preserves the owner UserAcl on cold and warm requests | PASS |
| submits the create form and persists the reshaped payload | PASS |

Four actual native browser/API cases passed once on this exact published head, zero skipped/retried. They exercise real form creation/persisted payload and delegated-key owner permissions, organization-scoped reads, denied writes, warm-cache invalidation and revocation.

The old forms failure trace showed no POST: the name became empty at submit despite earlier DOM checks. The fixture now waits for backend chrome readiness and types the name with real keyboard events after key/locales. Original30sredirect, payload/detail/list assertions and timeout/retry settings are preserved; no application guard was bypassed.

The same fixture correction passed3independent actual browser runs on ancestorb7b201cc. An intermediate main integration be1ea576 passed313auth-focused unit tests and4native cases. This latest970bmain merge passed715focused core/shared/search/CLI/enterprise unit tests, package builds, generation and typechecks before source publication.

The after image shows the successful create notification and redirect to Form editor; the editor itself is still loading at capture. The persisted key/name/status/default-locale/supported-locales shape and list membership were checked through the real API. Full Studio editing is not claimed.

The before image belongs to the failed previous082660dchead. All identities are disposable synthetic fixtures. The environment is stopped. Raw results, credentials, traces and logs remain local.

This is evidence-only OSS runtime validation. Enterprise unit coverage is documented separately; no enterprise runtime, independent review, human QA approval or PR merge is claimed. Required GitHub checks remain a separate gate.
