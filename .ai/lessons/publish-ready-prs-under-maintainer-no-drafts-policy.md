---
title: "Publish ready PRs under the maintainer's no-drafts policy"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["pull-request-publication","validation-gates","user-preferences","review-transitions"]
---

# Publish ready PRs under the maintainer's no-drafts policy

**Context**: The maintainer corrected the publication state of #7662: this repository does not accept draft PRs. The automation also incorrectly applied `changes-requested` before a qualifying review, using unrelated local environment failures while current-head CI was pending.

**Rule**: Publish ready PRs under this maintainer policy, initially in `review`. Track unfinished validation and review in the description and unchecked plan steps. Follow the invoked route and its repository overrides: pending CI yields incomplete evidence, and unrelated local diagnostics do not justify `changes-requested`. Only a qualifying review may drive that transition. Use the shared review schema and renderer rather than inventing verdict artifacts. Preserve review and merge gates; readiness does not imply completed review, passing validation, or permission to merge. An explicit user publication policy takes precedence over a skill's default draft workflow.
