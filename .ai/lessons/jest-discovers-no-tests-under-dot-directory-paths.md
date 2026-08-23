---
title: "Jest discovers no tests under dot-directory paths and moved worktrees dangle Yarn junctions"
modules: ["platform","cli","create_app"]
areas: ["architecture","testing"]
topics: ["dev-runtime","package-runtime","testing"]
---

# Jest discovers no tests under dot-directory paths and moved worktrees dangle Yarn junctions

**Context**: Staged-only agent workflows create isolated git worktrees under ignored,
dot-prefixed repo paths such as `.ai/tmp/om-fix-issue/<id>`, then run the package test
suites inside them. On Windows, Yarn's node-modules linker wires workspace packages
with NTFS junctions.

**Problem**: Jest's default `testMatch` globs never match path segments starting with
a dot (micromatch dotfile rule), so a checkout whose absolute path contains `.ai/`
reports "No tests found" for every package even though the config and files are
correct. Separately, NTFS junctions store absolute targets, so `git worktree move`
leaves every `node_modules/@open-mercato/*` link dangling and builds die with
`ERR_MODULE_NOT_FOUND` for workspace packages imported from `dist` output.

**Rule**: Keep agent worktrees under dot-free absolute paths (for example a sibling
directory outside the repository). After moving any worktree on Windows, delete
`node_modules` and reinstall so junctions are rebuilt against the new location;
`yarn install --immutable` alone will not rewrite existing junctions.

**Applies to**: every harness or wrapper run that creates, moves, or reuses linked
worktrees on Windows, and CI jobs that nest checkouts under dot-directories.
