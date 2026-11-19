---
title: "Preserve peer resolution when copying test dependencies"
modules: ["platform"]
areas: ["testing","debugging"]
topics: ["package-runtime","worktrees","peer-dependencies"]
---

# Preserve peer resolution when copying test dependencies

**Context**: An isolated PR test run failed in a raw ts-jest transformer because TypeScript exposed only its version instead of the compiler API. A dependency-copy optimization had replaced a workspace-local ts-jest directory with a root symlink of the same version. The original nested copy resolved a different TypeScript peer.

**Rule**: Equal package versions do not establish equal dependency contexts. Preserve nested dependency layout when copying installs into a worktree. Before labeling a failure as inherited, compare resolution from the actual failing importer in both checkouts, not merely from their roots. Repair environmental differences and rerun the exact configured command; a diagnostic preload does not establish that the normal gate passes.
