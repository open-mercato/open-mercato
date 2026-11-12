---
title: "Repository-source tests must register as cross-package guards"
modules: ["cli","catalog","create_app"]
areas: ["testing"]
topics: ["testing","module-boundaries","generated-files","cross-package-tests"]
---

# Repository-source tests must register as cross-package guards

**Context**: A generator regression reads live Catalog and Entities metadata to exercise standalone dependency closure across all generator variants.

**Problem**: The workspace test passed locally, but CI rejected the unclassified cross-package file. A package-filtered run can otherwise skip that regression when only its source metadata changes.

**Rule**: When a test starts reading repository files outside its own workspace, add its path and scan scope to `REPO_WIDE_GUARDS` in `scripts/repo-wide-guards.mjs`. Run the manifest classification test and the registered audit. Do not weaken the detector or use an exception for a regression that must follow its external source.

**Evidence**: PR #6823 failed `no test that audits other packages is left unclassified` for `module-subset.test.ts`; registering that audit restores the existing CI coverage contract.

**Runtime consumers (2026-10-27)**: This also applies when a package test executes a repository-owned consumer instead of inspecting source text. In PR #8089, `mercato.test.ts` replayed real initializer output through the root and create-app first-run shell scripts. The CLI suite passed, but `Test scripts` correctly rejected its missing classification. Registering it as an unfiltered guard protects script/template-only changes too; the classification and boot-script suites then passed all 24 tests. Check the manifest whenever a local test gains a root locator or starts executing a sibling package's script.
