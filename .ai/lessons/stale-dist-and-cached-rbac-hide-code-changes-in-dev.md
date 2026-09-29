---
title: "Stale package dist and cached RBAC make a correct fix look broken in dev"
modules: ["eudr","auth"]
areas: ["debugging","ai-workflow"]
topics: ["build-output","access-control","spec-pr"]
---

# Stale package dist and cached RBAC make a correct fix look broken in dev

**Context**: Three eudr debugging dead ends (2026-07-11) that all presented as "my change had no effect", with no error to follow.

**Rule**:
- The dev preview serves API routes from `packages/core/dist`, so editing a route file silently no-ops until `yarn workspace @open-mercato/core build` — rebuild core before concluding a route change failed.
- `yarn mercato auth sync-role-acls` updates the database, but a **running** dev server keeps serving the pre-sync grants from cache — restart the server (or invalidate the rbac cache) before re-testing a feature-gated 403.
- Cross-model reviewers on a very large staged diff each see only one auto-split path area and raise "missing deliverable" blockers for files in other areas — scope juries per cohesive area (`OM_XMR_PATHSPEC`) and reconcile per area, or the findings are artifacts.

**Applies to**: dev-loop debugging of package-served routes, RBAC/feature-gate testing against a running server, and multi-model review of large diffs.
