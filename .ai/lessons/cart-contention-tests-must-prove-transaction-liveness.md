---
title: "Cart contention tests must prove transaction liveness"
modules: ["cart"]
areas: ["module-data", "testing"]
topics: ["transactions", "concurrency", "pool-liveness"]
---

# Cart contention tests must prove transaction liveness

The TC-CART-CONC-05 repair carried in PR #5801 showed that blocking advisory waiters can retain every pooled connection while the holder needs another pricing-service query. A local mutex passed one-cart tests but failed a native two-process, two-cart counterexample.

Validate small and normal pool sizes with multiple processes and keys. Release unsuccessful transaction attempts before waiting, and never replay a mutation or uncertain commit. A contention deadline needs an explicit HTTP contract. Limit no-write claims to requested mutation phases because request preflight activity or context repricing may already have persisted. The generic flaky-test lesson retains the original evidence; this focused record keeps the transaction routing tags separate from its six-topic limit.
