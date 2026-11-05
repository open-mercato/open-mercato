---
title: "Provider credentials must never control authenticated cross-origin requests"
modules: ["auth","integrations","data_sync"]
areas: ["integration"]
topics: ["data-import","data-scoping","media"]
---

# Provider credentials must never control authenticated cross-origin requests

**Context**: The Akeneo client accepted an arbitrary tenant-provided `apiUrl` and also trusted absolute pagination or download URLs returned by the remote API.

**Problem**: A malicious or mistyped host could turn OAuth password-grant login into credential exfiltration, and hostile `next` or media download links could pivot authenticated bearer-token requests to a different origin.

**Rule**: For integration providers, normalize and validate the configured base URL server-side before any network call, restrict it to an operator-owned allowlist plus a safe scheme/origin shape, build OAuth endpoints from fixed paths, and reject any absolute follow-up URL whose origin differs from the validated provider origin.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/client.ts`, provider-specific HTTP clients, OAuth/token helpers, pagination cursors, media download helpers, and any future integration that consumes remote absolute URLs.
