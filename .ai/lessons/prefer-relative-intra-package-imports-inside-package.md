---
title: "Prefer relative intra-package imports inside package CLI/runtime entrypoints"
modules: ["cli"]
areas: ["architecture"]
topics: ["package-runtime","runtime-startup","testing"]
---

# Prefer relative intra-package imports inside package CLI/runtime entrypoints

**Context**: The core entities CLI imported its own package internals through `@open-mercato/core/...` aliases.

**Problem**: Dist-time ESM resolution became brittle in initialization flows and failed to resolve package-internal files that were present locally.

**Rule**: Inside a package's own CLI/runtime entrypoints, prefer local relative imports for same-package modules instead of going back through the package alias, unless that alias path is explicitly part of the public runtime contract.

**Applies to**: `cli.ts`, bootstrap helpers, package-local scripts, and other runtime entrypoints executed directly from dist.
