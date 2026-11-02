---
title: "Propagate async undo refusals before snapshot access"
modules: ["warranty_claims"]
areas: ["module-data", "testing", "debugging"]
topics: ["command-pattern", "undo", "async-control-flow", "typecheck"]
---

# Propagate async undo refusals before snapshot access

**Context:** PR #7359 builds projected aggregate line state before applying an undo. Its localized refusal helper returns `Promise<never>`.

**Failure:** Calling that helper without returning or awaiting it inside a synchronous `map` neither terminates the callback nor narrows optional snapshots. CI reported TS18048, and a missing snapshot could also trigger property access after scheduling the refusal.

**Rule:** Propagate an asynchronous refusal from the enclosing async operation before accessing guarded state. Use a loop when projection needs that early return. Keep missing-snapshot and unchanged historical-duplicate regressions, and run the strict TypeScript compiler on changed source; passing Jest does not establish compiler success.
