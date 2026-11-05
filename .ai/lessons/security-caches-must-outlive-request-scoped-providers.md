---
title: "Security caches must outlive request-scoped providers and cover reserved IPv6 space"
modules: ["cache","auth","cli"]
areas: ["integration","umes"]
topics: ["data-scoping","network-security","provider-lifecycle"]
---

# Security caches must outlive request-scoped providers and cover reserved IPv6 space

**Context**: OIDC discovery hardening initially cached configurations on a provider that dependency injection recreates per request, while the shared IP classifier omitted several IANA-reserved IPv6 prefixes.

**Rule**: Put bounded outbound-discovery caches at process scope when providers are request-scoped, key them by every credential/config input, and verify reserved IPv4 and IPv6 ranges against public-address controls.

**Applies to**: SSRF guards, OIDC/OAuth discovery, JWKS/token/user-info clients, and request-scoped outbound provider services.
