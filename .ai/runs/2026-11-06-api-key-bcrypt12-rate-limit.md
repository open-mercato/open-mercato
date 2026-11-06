# Carry forward #8376: cost 12 with verification work limits

PR: https://github.com/open-mercato/open-mercato/pull/8899

- [x] Analyze the original issue, CPU-amplification finding, comparison-cache proposal and all verification consumers.
- [x] Raise new hashes to cost 12 and implement constant-memory, queue-free admission before bcrypt.
- [x] Preserve retryable overload across application, MCP, settings/provisioning and OAuth consumers.
- [x] Pass the configured local validation gate and all 13 live API-key tests.
- [x] Complete independent source security review and publish the credited carry-forward.
- [x] Pass all 44 expanded authorization integration tests, preserving raw immediate-denial and replay-race assertions.
- [ ] Complete refreshed exact-head CI after the latest base merge.
- [ ] Obtain formal human review and risk-high QA approval before merge.

## Design

The limiter allows one expensive verification at a time with no queue. After each attempt it reserves at least 250 ms or three times the observed verification duration. Rejected attempts do not extend the deadline. It retains no credentials, hashes, fingerprints or comparison outcomes. The existing request-auth cache is separate and is not the CPU-protection boundary. Ingress/distributed rate limiting remains necessary for bandwidth, database work and fairness; this process-local budget does not promise uninterrupted authentication under sustained abuse.

## Evidence

- Main `f60620c07d` was incorporated, then updated to `c9f31972aa`. The only conflict was the independently fixed harness-budget assertion; resolution retains exact context membership and main’s exclusion check over both required and optional files.
- Full local gate passed: package builds, generation, rebuild, translation sync/usage, typecheck, full tests (51 workspace tasks), app build and template parity. Enterprise modules were enabled. Core passed 2,697 suites / 27,103 tests; application 116 / 809; enterprise 246 / 2,248; AI assistant 134 / 1,808.
- All 13 managed API-key integration tests pass against an isolated app/database, including new cost-12 issuance, changing-guess throttling, valid-key recovery without poisoned negative cache, immediate deletion revocation, role/scope/expiry checks.
- A real cost-12 burst of 1,000 changing wrong suffixes admitted one comparison and throttled 999 in 222 ms wall/CPU time on this host. A valid key succeeded after recovery.
- Independent security review found no remaining source blockers. Overload never becomes an invalid credential or rotates an MCP key. OAuth rotation selects one scoped candidate, including overlapping cost-10/cost-12 credentials.
- The gate exposed additional OAuth handling and malformed SCIM hash fixtures; both were fixed without removing assertions. An outdated create-app harness assertion now verifies main's exact five required paths, one allowed extra and six-file budget.
- Local reruns initially overlapped generated build artifacts and inherited integration webhook settings. A subsequent clean, sequential full unit run passed all 51 tasks; neither execution problem was waived or patched around in source.

## Expanded authorization coverage

A bounded test-client helper retries only 429 with positive finite Retry-After, at most four times, and never retries 401/403. Existing authorization specs use it explicitly for cold keys and setup outside concurrency windows. All final status/body/scope assertions remain intact. Warm-cache immediate revocation checks, concurrent replay requests and flood assertions remain raw. Independent review approved this test-only delta; package builds, typecheck and template parity pass. The expanded managed integration run passes all 44 tests. Refreshed CI is pending after incorporating the latest CLI-presentation-only base update.

Formal human approval and QA remain separate from local source review and automated evidence. No merge or QA approval is claimed.

## CI stabilization and internal callers

The full CI on `b939d1a60` settled with 31 successful checks, three skipped and one failing integration shard. Its only failing case was warranty external API validation: a second cold key received the new 429 before the expected 400. All other integration shards passed. The warranty and attachment test adapters now honor bounded 429 retry guidance without changing their exact authorization/domain assertions.

A comprehensive transport audit also covered indirect one-time-key callers. Business rules and workflows now retry only marked authentication-only 429 responses at the inner HTTP call, preserving the same temporary key and finally cleanup. Reserved markers are emitted only on verified safe authentication rejection paths. Generic business 429s, other statuses and ambiguous network failures receive no new retries. Redirects are manual; workflow origin guards remain, and business calls reject redirects. Backoff honors AbortSignal, is limited to three retries, and checks a ten-second monotonic retry window before starting another request; ongoing fetch timeout behavior remains caller-owned.

Focused evidence: 19 shared retry tests, 282 workflow/business tests, 44 dispatcher/SCIM tests, 27 MCP/settings HTTP tests and two OAuth throttle tests pass. Independent security review approved replay safety, safe marker sites and deadline handling. Fresh validation, expanded live tests including indirect callers, and refreshed CI remain pending. Main advanced while CI ran; the next checkpoint incorporates its latest changes before final validation.

The latest base requires strong superadmin bootstrap credentials when initializing the production-mode ephemeral app. The integration CI job now generates a masked disposable credential and shares it with initialization and test helpers, preserving the guard rather than using weak-password bypasses. Local managed runs supply the same kind of disposable credential. The fresh full configured gate passes on the new code and latest incorporated base; expanded live consumer verification and refreshed exact-head CI are pending.
