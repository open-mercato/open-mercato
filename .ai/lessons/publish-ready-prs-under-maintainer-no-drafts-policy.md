---
title: "Publish ready PRs under the maintainer's no-drafts policy"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["pull-request-publication","validation-gates","user-preferences"]
---

# Publish ready PRs under the maintainer's no-drafts policy

**Context**: The maintainer corrected the publication state of #7662: this repository does not accept draft PRs. An automation skill had used draft status to represent unresolved validation.

**Rule**: Publish ready PRs under this maintainer policy. Track unfinished validation, failed checks, and required follow-up in the PR description, review evidence, and applicable labels. Preserve review and merge gates; readiness does not imply passing validation or permission to merge. An explicit user publication policy takes precedence over a skill's default draft workflow.
