---
title: "Prefer canonical route paths over alias lists for custom APIs"
modules: ["cli","create_app"]
areas: ["umes","architecture"]
topics: ["generated-files","package-runtime","testing"]
---

# Prefer canonical route paths over alias lists for custom APIs

**Context**: Payment and shipping endpoints were still using the legacy `api/<method>/...` layout, and shipping added alias matching because its public URL was kebab-case while the module id is snake_case.

**Problem**: That created two layers of indirection: legacy filesystem conventions plus multiple candidate URLs in the registry, which made standalone and generator debugging harder.

**Rule**: For custom APIs, prefer the standard `api/<segment>/route.ts` layout. If the public URL must differ from the generator default, declare one canonical `metadata.path` override on the route instead of alias lists or app-route special cases.

**Applies to**: Module API routes, generator path mapping, and any future public endpoint refactors.
