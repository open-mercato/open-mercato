# Provider Security and Reliability

Load this reference for every external provider.

- Encrypt credentials through host services. Thread per-user scope on every per-user read/write; tenant-wide scope never sees those rows.
- Validate configurable URLs for SSRF, redirects, private networks, protocols, and DNS. Bound request/response size and timeout.
- Redact headers/tokens/credentials/signed URLs/sensitive bodies from logs, events, errors, and fixtures.
- Verify inbound signatures on raw body with timestamp/replay limits; make duplicates idempotent.
- Use bounded exponential retry with jitter and explicit handling of timeouts, 429/retry-after, 5xx, invalid payloads, and terminal 4xx.
- Persist a stable idempotency key for every remote mutation; reuse it across transaction rollback and worker retry.
- Reconcile provider truth after ambiguous/partial responses. Protect state transitions against webhook/poll/manual races.
- Keep API-version/capability/site/store/currency variants explicit and validated.

Tests cover normal, duplicate, concurrent, timeout, rate limit, malformed, partial, signature, replay, and redaction behavior.
