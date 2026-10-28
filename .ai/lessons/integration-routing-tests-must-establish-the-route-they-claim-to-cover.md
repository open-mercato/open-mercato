---
title: "Integration routing tests must establish the route they claim to cover"
modules: ["search","query_index"]
areas: ["testing","integration","debugging"]
topics: ["async-indexing","polling","query-index","route-coverage","embedding-privacy"]
---

# Integration routing tests must establish the route they claim to cover

**Context**: A search-token fallback test created a record and immediately searched for it before deleting its tokens.

**Problem**: Token indexing is asynchronous, so the first search could already use the plain-column fallback. The test could pass without ever exercising the token-backed route, while also decoding the create response from the wrong envelope.

**Rule**: Decode fixture responses through the shared API helpers, then poll the authoritative persistence condition before asserting behavior that depends on an asynchronous route. Prove both the precondition and the fallback transition. When the endpoint applies presentation-level merging, query each source entity type separately to prove that every document was indexed before asserting the merged result. Polls with multiple conditions must return a diagnostic string that identifies the failing response or invariant instead of a bare boolean.

**Applies to**: search indexing, background projections, cache-backed routing, async event handlers, and integration tests that claim to cover a specific execution path.

**Search privacy correction (#7826)**: Passing by-ID provider-boundary tests did not cover the exported bulk API, which skipped safe source construction. Exercise every supported single/batch/bulk entry point and inject source errors, null/empty outputs, scoped encryption additions, and policy lookup failures. Capture both embedding-provider inputs and storage writes; a successful source-builder unit test cannot prove that every consuming path uses it.
