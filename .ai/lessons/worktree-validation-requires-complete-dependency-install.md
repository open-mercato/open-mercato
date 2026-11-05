---
title: "Worktree validation requires a complete dependency install"
modules: ["cli","shared"]
areas: ["testing","debugging"]
topics: ["worktrees","package-runtime","validation"]
---

# Worktree validation requires a complete dependency install

**Context**: A Yarn node-modules workspace can have dependencies installed both at the repository root and inside individual workspaces.

**Problem**: Copying only the root node_modules can make package-local compilers disappear or make ts-jest resolve the root native TypeScript package instead of its workspace JavaScript compiler. This looks like a source regression despite an unchanged lockfile.

**Rule**: Before classifying such a failure as a repository blocker or changing compiler configuration, run yarn install --immutable in the isolated checkout. Verify the runtime and package-local dependency resolution, then rerun the failed check. Preserve the committed lockfile. Also serialize application builds with browser verification against that build directory: replacing Next chunks under a running server invalidates browser evidence.

**Evidence**: In the #8137/#8599 repair, an immutable install restored missing workspace dependencies; both unchanged web-research model and SearXNG suites passed. A browser trace with chunk 404/500 responses identified a concurrent build rather than a quote-flow failure.
