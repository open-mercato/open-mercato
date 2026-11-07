# Agent OAuth integration with API-key verification throttling

## Scope

Companion to `../2026-11-06-api-key-bcrypt12-rate-limiting.md`. Agent client-secret provisioning reuses API-key issuance, so new hashes use cost 12. Direct OAuth verification must share the CPU work gate and preserve retryable overload semantics.

## Behavior

The identity token endpoint retains its fail-closed client-IP quota before credential work. It additionally returns 429 with Retry-After when the shared verifier is occupied or recovering, rather than invalid_client. Actual credential failures remain 401.

Client-secret lookup retains principal/name/owner/organization/deletion/expiry checks and narrows by the existing globally unique 12-character key prefix. At most one real comparison is needed, so overlapping rotated keys both work without requiring comparisons through older live candidates first. Missing candidates still use a dummy comparison whose outcome cannot authenticate. The dummy now has cost 12; legacy cost-10 credentials remain supported but do not have identical comparison timings.

## Migration & Backward Compatibility

No entity, credential format, schema, JWT audience, grant scope or token payload changes. No key rotation or migration is needed. Existing 429 behavior gains an additional cause and retry guidance. Internal callers propagate temporary overload rather than revoking or replacing credentials. The existing prefix uniqueness constraint remains unchanged.

## Evidence and limits

Real bcrypt/JWT tests cover legacy keys, both overlapping rotated keys, grant narrowing, disabled principals and audience isolation. Separate tests cover dummy comparison paths and HTTP 429 versus invalid_client. The shared verifier's concurrency and recovery tests cover distributed guesses within a process. Ingress limits remain necessary across processes; this guard does not promise capacity fairness under sustained abuse.

## Changelog

- 2026-11-06: carry-forward of #8376 adapts the existing OAuth consumer to cost-12 verification admission.
