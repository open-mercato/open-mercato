# API-key bcrypt cost 12 with bounded verification

## TLDR

Carry forward closed PR #8376 and resolve #3811. New regular, one-time and session API keys use bcrypt cost 12. Existing cost-10 and cost-12 credentials continue to work. Replace the comparison-result cache proposed on #8376 with an always-on, constant-memory verification work limiter shared by application and MCP callers.

## Problem and threat model

The public 12-character key prefix is a lookup selector, not proof of possession. An attacker can submit indefinitely changing wrong suffixes for a known prefix. A negative cache keyed by complete secrets does not bound that traffic. Increasing bcrypt from 10 to 12 without pre-verification admission multiplies the expensive work per admitted request by four.

The user explicitly requested cost 12 and rate limiting instead of the proposed comparison cache on 2026-11-06. This supersedes the withdrawn cost-10/cache proposal on #8376.

## Design

`verifyApiKey` delegates to one process-local verifier, including when reached from `findApiKeyBySecret`. All current application, HTTP MCP, in-process MCP, agent OAuth and credential-management consumers use that service.

- Validate the stored bcrypt hash shape before admission.
- Admit at most one comparison at a time, before calling bcrypt. There is no waiting queue.
- On completion, including a thrown comparison error, reserve recovery for the larger of 250 ms or three times the observed verification duration, measured with monotonic `performance.now()`.
- Rejected attempts do not change the recovery deadline. Changing suffixes, prefixes, hashes or clearing the existing request cache cannot reset this shared work budget.
- Do not retain credentials, hashes, fingerprints, or comparison results in limiter state. Its state is one active flag and one deadline.
- Separate throttling from an invalid credential. Throw `ApiKeyVerificationRateLimitError` with retry guidance; do not return a false comparison or cache an authentication miss.

The recovery budget bounds sustained comparison duty cycle to at most approximately one quarter of observed wall time after the initial admitted comparison. It adapts to slower hosts and higher-cost legacy hashes instead of assuming one bcrypt cost consumes a fixed number of milliseconds. This is not a hard deadline that can interrupt an already running hash.

The pre-existing request-authentication cache remains compatible. It is an independent optimization, not the protection against this attack. The CPU protection works with that cache disabled or repeatedly cleared; positive and negative bcrypt comparison caching is not added.

## API and integration behavior

Application authentication reports overload as retryable auth-resolution `error` with optional `retryAfterMs`. The API dispatcher returns HTTP 429 with `Retry-After`, preserving cookies. Existing infrastructure failures still return 503. No existing resolution-status enum member is removed or repurposed.

HTTP MCP returns 429 with `Retry-After` for verification overload, and retains 401 for genuinely invalid or expired credentials. Internal MCP authentication propagates the typed overload error. MCP settings returns retryable overload instead of reporting the key as unconfigured. Agent OAuth keeps its existing pre-credential IP quota, adds capacity-overload 429 handling, and narrows its secret candidate to the existing unique prefix so overlapping rotations require at most one real comparison. Its dummy comparison uses cost 12; legacy cost-10 timings remain different. Credential provisioning aborts on that error without deleting or rotating a valid key or changing its secret file.

Data models, secret format, prefix uniqueness, database schema, entity scoping, role checks and exported verification signatures are unchanged. Normal bcrypt true/false outcomes retain their meaning. `verifyApiKey` already returns a rejecting promise for verification failures; the new overload error gives consumers an explicit retryable failure rather than silently manufacturing a bad credential.

## Internal API callers

Business-rule `CALL_OPEN_MERCATO` and workflow `CALL_API` use a temporary key for inner HTTP calls. They keep the same key alive while retrying only a marked authentication-capacity rejection. The reserved `x-om-api-key-verification-throttled: 1` response header is emitted by the API authentication dispatcher, native MCP authentication, the read-only settings key probe and OAuth verification before token issuance. These paths have not performed the requested state-changing operation; an arbitrary business-handler 429 is unmarked.

The shared server HTTP helper allows at most three retries with positive integer Retry-After, starts retries within a ten-second monotonic window, cancels rejected response bodies and honors the caller's AbortSignal during both fetch and backoff. A scheduling stall beyond that window stops before another request with a typed capacity error. Existing in-flight request timeout behavior remains with the caller. Unmarked 429, 400/401/403, other failures and ambiguous network errors receive no new transport retries. The surrounding action/workflow is not replayed by this helper.

Both callers already validate internal platform API URLs. Fetch remains manual for redirects: workflows retain their existing same-origin `/api/` redirect checks; business-rule calls now reject redirect responses so only the intended internal endpoint can supply the authentication marker. Temporary-key cleanup remains in the existing finally block after the entire call, including retries or aborts.

## Risks and deployment

- A process-local limiter bounds work per application/MCP process, not aggregate ingress across replicas. Deploy all verification processes. Reverse-proxy/WAF or shared ingress rate limits remain necessary for distributed request volume, connection pressure and database work preceding comparison.
- An attacker can consume the available verification slots and temporarily deny uncached authentication. This protects the rest of the process from unbounded bcrypt work; it does not promise fairness or uninterrupted API availability during sustained attack.
- Cold credentials and cacheless MCP traffic must handle 429 and retry after the indicated delay. Successful authentication does not bypass the work limit. No implicit cache is used to conceal that capacity cost.
- A running comparison cannot be preempted. The recovery period accounts for its observed duration, but unusually expensive pre-existing hashes may still create a long initial verification. New hashes have the fixed, tested cost 12.
- No password hashing policy, provider credentials, production dependency, secret provisioning, database migration or deployment configuration is changed.

## Migration & Backward Compatibility

No key rotation, hash rewrite, schema migration or wire credential change is required. Existing bcrypt hashes encode their own cost and continue to verify. New hashes use cost 12. Clients should honor the additive 429/Retry-After response. Retry guidance while an operation is active is an estimate, not an admission guarantee; slow hashes and competing traffic can require further retries. Internal callers must not interpret `ApiKeyVerificationRateLimitError` as invalidity or rotate credentials on overload. Existing stored key authorization, expiry and deletion checks remain live as before.

## Verification

- Real bcrypt: regular/session creation at cost 12, correct/wrong secrets, cost-10 and cost-12 compatibility without rewriting stored hashes.
- Work limiter: varied suffixes and prefixes, concurrent flood, sustained traffic, slow comparisons, minimum spacing, errors, recovery, no outcome caching, no deadline extension on rejected work, and malformed hash rejection.
- Consuming paths: actual application and MCP authentication share the budget with auth caches cleared; a throttled valid key is not negatively cached and succeeds on retry; application dispatcher returns 429 without clearing cookies; real HTTP MCP boundary distinguishes 429 from 401; provisioning preserves the existing key and file on overload.
- Existing session-role revocation integration assertions remain intact; their clock advances between independent authentication attempts so they exercise authorization independently of the work limiter.
- Run the configured package/generate/i18n/typecheck/test/app-build gate, template parity, independent security review and final-head CI. Pending or failed gates are reported, not waived.

## Changelog

- 2026-11-06: user-authorized cost-12 carry-forward with cache-independent work admission and explicit retryable overload semantics.

## References

- [OWASP DoS guidance](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html): bound expensive work and apply rate limits before it.
- [OWASP password-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): higher bcrypt work factors also raise online CPU costs. These API keys are random high-entropy secrets, not human passwords; the user explicitly requested retaining bcrypt at cost 12.
