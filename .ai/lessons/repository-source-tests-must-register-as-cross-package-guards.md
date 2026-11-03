---
title: "Repository-source tests must register as cross-package guards"
modules: ["cli","catalog"]
areas: ["testing"]
topics: ["testing","module-boundaries","generated-files"]
---

# Repository-source tests must register as cross-package guards

**Context**: A generator regression reads live Catalog and Entities metadata to exercise standalone dependency closure across all generator variants.

**Problem**: The workspace test passed locally, but CI rejected the unclassified cross-package file. A package-filtered run can otherwise skip that regression when only its source metadata changes.

**Rule**: When a test starts reading repository files outside its own workspace, add its path and scan scope to `REPO_WIDE_GUARDS` in `scripts/repo-wide-guards.mjs`. Run the manifest classification test and the registered audit. Do not weaken the detector or use an exception for a regression that must follow its external source.

**Evidence**: PR #6823 failed `no test that audits other packages is left unclassified` for `module-subset.test.ts`; registering that audit restores the existing CI coverage contract.
