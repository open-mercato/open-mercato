---
title: "Verify persisted state with fresh CRUD reads"
modules: ["customers","shared"]
areas: ["testing","integration","module-data"]
topics: ["cache","data-integrity","testing"]
---

# Verify persisted state with fresh CRUD reads

**Context**: Customer delete/undo address regressions read the same list URL before and after mutations while CRUD GET caching was enabled.

**Problem**: A parent mutation did not invalidate the child address response cache. The delete assertion received the original populated address, and an undo assertion could falsely accept those same cached values without verifying restoration.

**Rule**: Persistence-focused integration tests must read fresh state after each mutation. The CRUD factory includes all query parameters in its response cache key; for routes whose list schema accepts extra parameters, a unique `randomUUID()` query value forces a fresh response without changing the selected records. Check that `x-om-cache` is not `hit` and retain all identity, field, and deletion assertions. Test cache invalidation separately when that is the intended behavior.

**Applies to**: API persistence and undo/redo tests that repeatedly read cached CRUD collection routes, especially after parent commands mutate child entities.
