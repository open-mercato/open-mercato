---
title: "System encryption map discovery must fail closed"
modules: ["onboarding","shared"]
areas: ["module-data","architecture"]
topics: ["data-integrity","encryption","runtime-startup"]
---

# System encryption map discovery must fail closed

**Context**: Pre-tenant onboarding records rely on system-scoped encryption maps that must be discovered before the encryption subscriber starts handling writes.

**Rule**: Treat failures while loading security-sensitive encryption maps as startup failures. Do not silently register encryption with an incomplete map set, because later writes could persist protected fields as plaintext.

**Applies to**: System-scoped encryption maps, bootstrap-time module discovery, encryption subscriber registration, and other fail-closed security registries.
