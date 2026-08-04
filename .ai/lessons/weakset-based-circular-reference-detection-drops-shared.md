---
title: "WeakSet-based circular reference detection drops shared (non-circular) object references"
modules: ["cache","events","shared"]
areas: ["module-data","architecture"]
topics: ["events","generated-files","testing"]
---

# WeakSet-based circular reference detection drops shared (non-circular) object references

**Context**: The CLI OpenAPI generator (`packages/cli/src/lib/generators/openapi.ts`) used a `WeakSet` in `safeStringify` to detect circular references during JSON serialization. The `zodToJsonSchema` converter uses a `WeakMap` memo cache that returns the same JS object reference for identical Zod schema instances (e.g., `currencyCode` shared between quote and line item schemas).

**Problem**: The `WeakSet` treated shared-but-non-circular references as circular, dropping them on second encounter. This caused properties like `currencyCode` to vanish from nested schemas in the generated `openapi.generated.json`. The line item schema was missing required fields, which misled AI agents and broke API payload construction.

**Rule**: When detecting circular references in JSON serialization, use stack-based ancestor tracking (checking only the current path from root to node) instead of a `WeakSet` (which tracks all previously visited nodes globally). Shared references are legitimate and must be cloned, not dropped.

**Applies to**: Any serialization code that processes object graphs with shared references (common in Zod schema conversions, AST tools, and dependency graphs).
