---
title: "DNS pinning must keep fetch and dispatcher implementations compatible"
modules: ["events"]
areas: ["integration","testing","debugging"]
topics: ["events","network-security","package-runtime"]
---

# DNS pinning must keep fetch and dispatcher implementations compatible

**Context**: A pinned outbound request used an `undici` package `Agent` with Node's bundled global `fetch`, then returned only the legacy single-address DNS callback shape while Node 24 requested all addresses.

**Rule**: Use `fetch` and `Agent` from the same `undici` implementation, and make custom lookup callbacks support both single-address and `{ all: true }` result shapes. Cover the dispatcher path with a regression test and smoke-test at least one real HTTPS endpoint.

**Applies to**: SSRF-safe fetch helpers, custom `undici` dispatchers, DNS pinning, and runtimes that enable automatic address-family selection.
