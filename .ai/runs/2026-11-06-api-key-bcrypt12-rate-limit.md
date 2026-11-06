# Carry forward #8376: cost 12 with verification work limits

- [x] Read the original issue, security finding, cache implementation, and application/MCP callers.
- [x] Replace comparison-result caching with an always-on, constant-memory work limiter; raise new hashes to 12.
- [x] Cover changing suffixes/prefixes, concurrent attempts, sustained attempts, failures, recovery, live records, and legacy hashes.
- [ ] Measure real bcrypt behavior, run validation, review, and publish the carry-forward PR.

The limiter serializes expensive verification with no pending queue. After each attempt it reserves at least 250 ms and three times the observed verification duration before another comparison may start. Rejected requests do not extend the deadline. This bounds sustained verification duty cycle even on slower hosts, without retaining credentials or comparison outcomes. The existing request-authentication cache is separate and is not the protection boundary. Ingress/distributed request rate limiting remains necessary for bandwidth, database work, and fairness; a local work budget does not promise availability under sustained abuse.

## Evidence

- API-key module: 98 tests pass. MCP core paths: 39 tests pass, settings: 24 tests pass, API dispatcher: 29 tests pass. OAuth consumer: 16 tests pass after correcting its overload handling and single-candidate rotation lookup.
- A real cost-12 burst of 1,000 changing wrong suffixes admitted one comparison and throttled 999 attempts in 222 ms wall/CPU time on this host; the valid key succeeded after the recovery interval.
- Independent source security review found no remaining blockers, conditional on final configured validation and E2E.
- First full gate passed all commands except tests, which exposed the additional OAuth verifier consumer. That consumer was fixed, not waived. The gate is being rerun with enterprise modules enabled.

## Final validation progress

- Updated target to main `f60620c07d` without conflicts. Package builds, generation, translation sync/usage, typecheck, app build and template parity pass.
- Full tests passed core (2,697 suites / 27,103 tests), application (116 / 809), enterprise (246 / 2,248) and AI assistant (134 / 1,808). The one deterministic create-app failure was an outdated three-file expectation after main added three required CLI references. Its correction asserts all five required paths, the single permitted extra and exact six-file budget; independent review approved it.
- The first live API-key run passed 12/13 tests, including the new real cost-12/burst/recovery/revocation test. Existing scope test 008 now honors only explicit 429/Retry-After, still rejects 401 immediately and requires 200 for every valid scope. Independent review approved the unchanged scope assertions.
- A parallel local integration build replaced create-app assets during the full test rerun and caused four ENOENT errors. Final integration and full tests are rerunning sequentially against stable artifacts. No full-gate or merge-ready claim is made while those results remain pending.
