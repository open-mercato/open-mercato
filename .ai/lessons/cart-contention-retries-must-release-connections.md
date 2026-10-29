---
title: "Cart contention retries must release connections"
modules: ["cart","sales","shared"]
areas: ["module-data","integration","testing"]
topics: ["transactions","database-pool","workers","testing"]
---

# Cart contention retries must release connections

The cart `TC-CART-CONC-05` failure had a different root cause: blocking advisory waiters retained every pooled connection while the holder needed a separate pricing-service query. A local per-cart mutex passed one-cart tests but failed a native two-process/two-cart counterexample. Validate pool sizes and multiple processes/keys, release unsuccessful transaction attempts before backoff, and never replay mutation/uncertain-commit errors. A new deadline needs an explicit documented HTTP contract. Scope any no-write guarantee to the requested mutation phases: existing request preflight activity or repricing may already have persisted.
