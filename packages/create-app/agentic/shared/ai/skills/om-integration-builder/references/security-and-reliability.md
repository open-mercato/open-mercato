# Provider Security and Reliability

Load this reference for every external provider.

- Encrypt credentials through host services (`encrypted-credentials`). Thread per-user scope on every per-user read/write. Tenant-wide scope is valid only when the installed provider/job contract declares it; it never sees per-user or organization-owned rows without deriving their narrower trusted scope.
- Validate configurable URLs for SSRF, redirects, private networks, protocols, and DNS. Bound request/response size and timeout.
- Redact headers/tokens/credentials/signed URLs/sensitive bodies from logs, events, errors, and fixtures.
- Verify inbound signatures on raw body (`webhook-signature`) with timestamp/replay limits (`replay-protection`); atomically claim each inbox delivery before side effects (`atomic-inbox-claim`) and make duplicate callbacks/subscribers idempotent (`subscriber-idempotency`).
- Use bounded exponential retry with jitter and explicit handling of timeouts, 429/retry-after, 5xx, invalid payloads, and terminal 4xx.
- Persist a stable idempotency key for every remote mutation; reuse it across transaction rollback and worker retry.
- Reconcile provider truth after ambiguous/partial responses. Protect state transitions against webhook/poll/manual races.
- Health checks and OAuth refresh retries redact credentials and provider details (`health-retry-redaction`); concurrent refresh uses one guarded winner (`oauth-single-flight-refresh`).
- Keep API-version/capability/site/store/currency variants explicit and validated.

Tests cover normal, duplicate, concurrent, timeout, rate limit, malformed, partial, signature, replay, and redaction behavior.
