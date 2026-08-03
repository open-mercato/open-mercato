---
title: "Use `safeExtend()` when composing refined Zod object schemas"
modules: ["shared","checkout"]
areas: ["architecture"]
topics: ["generated-files","schema-composition"]
---

# Use `safeExtend()` when composing refined Zod object schemas

**Context**: Checkout pay-link validators extended a schema that already contained `superRefine(...)` rules.

**Problem**: Zod v4 throws at runtime when `.extend()` is used on object schemas that contain refinements. This broke both OpenAPI generation and app initialization with `Object schemas containing refinements cannot be extended`.

**Rule**: Any time a Zod object schema has refinements (`refine`, `superRefine`, similar), compose follow-up schemas with `.safeExtend()` instead of `.extend()`.

**Applies to**: Module validators, generated OpenAPI bundling, bootstrap/init code paths, and any schema reuse chain built on refined objects.
