---
title: "Standalone agent context must follow the installed package, not the checkout layout"
modules: ["checkout","create_app"]
areas: ["framework-context","architecture"]
topics: ["generated-files","database-migrations","package-runtime"]
---

# Standalone agent context must follow the installed package, not the checkout layout

**Context**: Generated apps ignore `node_modules`, while coding agents still need the exact root, package, and module `AGENTS.md` contracts plus implementation source for the installed Open Mercato version.

**Rule**: Publish source and instruction files in package tarballs, resolve them through the app's declared module package and exact installed version, and materialize only the requested read-only context outside `node_modules`. Keep a versioned root/BC snapshot for offline fallback, report version skew, and never teach agents to edit or broadly ingest installed dependencies.

**Applies to**: `create-mercato-app`, `agentic:init`, package publication contracts, generated module facts, and any standalone harness escape hatch for framework implementation details.
