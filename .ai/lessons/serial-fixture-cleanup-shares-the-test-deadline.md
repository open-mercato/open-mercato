---
title: "Serial fixture cleanup shares the test deadline"
modules: ["planner"]
areas: ["testing","integration"]
topics: ["testing","flaky-tests"]
---

# Serial fixture cleanup shares the test deadline

**Context**: TC-PLAN-005 created 105 availability rule sets in batches of 25 but deleted them one by one in its `finally` block. A CI trace showed the UI assertion passing at 12.7 s, then ninety sequential DELETEs (median 69 ms) consuming the rest of the 20 s Playwright deadline; the test timed out during teardown with no hung request.

**Rule**: A `finally` block runs inside the same Playwright test timeout as the body, so a passing assertion can still be followed by a timeout. Per-request `.catch(() => undefined)` only suppresses errors; it does not remove the cumulative cost of serial requests. Await dependent cleanups first (records that reference others), then delete independent fixtures in bounded parallel batches matching the setup batch size, rather than raising the timeout or skipping cleanup.

**Applies to**: integration specs that create many fixtures to reach pagination or limit boundaries, and any teardown whose request count scales with fixture volume.
