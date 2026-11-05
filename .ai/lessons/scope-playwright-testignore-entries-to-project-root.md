---
title: "Scope Playwright `testIgnore` entries to project root absolute paths"
modules: ["platform"]
areas: ["testing","integration"]
topics: ["data-scoping","testing","type-normalization"]
---

# Scope Playwright `testIgnore` entries to project root absolute paths

**Context**: Running integration tests from a worktree under a parent path containing `.codex` caused Playwright to report `No tests found`.

**Problem**: A relative ignore glob like `.codex/**` can match parent path segments in some environments, unintentionally excluding all discovered tests.

**Rule**: In `.ai/qa/tests/playwright.config.ts`, build `testIgnore` patterns from `projectRoot` absolute paths (normalized), for example `${normalizePath(path.join(projectRoot, '.codex'))}/**`, instead of loose relative globs.

**Applies to**: Integration Playwright config and any future test discovery/ignore configuration.
