---
title: "Shared send budgets must disable per-process insurance fallback"
modules: ["checkout", "shared"]
areas: ["architecture", "testing"]
topics: ["rate-limiting", "network-security", "failure-states"]
---

# Shared send budgets must disable per-process insurance fallback

**Context**: The checkout start-email budget checked `result.degraded`, but the shared rate limiter's Redis insurance layer returned an ordinary allowed result from a fresh memory bucket during a Redis outage. Each worker could regain a recipient or link allowance after the shared quota was exhausted (#9159).

**Rule**: When an enabled send budget selects Redis, pass `requireShared: true` to `RateLimiterService.consume`. A degraded-result check alone cannot detect a successful insurance fallback. Preserve explicitly configured memory behavior and global disable behavior deliberately.

**Evidence**: The checkout `startEmailBudget` regression uses the real `RateLimiterService` and limiter implementation with an unavailable Redis client. Its control call proves an unprotected consume succeeds through memory insurance; the protected budget rejects and never consumes memory. Cover missing shared storage as well as an explicit degraded mock.

**Delivery boundary**: Do not promise retries solely because a worker throws. Checkout's async queue retries failures; its default inline delivery subscriber logs and resolves them without scheduling another attempt.
