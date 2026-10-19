---
title: "Respect explicit PR publication state"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["pull-requests","user-instructions","validation"]
---

# Respect explicit PR publication state

**Context**: PR #7661 was left as a draft after unrelated full-gate failures. The user clarified that this project accepts only ready-for-review pull requests.

**Rule**: Publish pull requests ready for review under the explicit no-drafts policy, including when a generic skill would create or retain a draft. Keep failing validation, incomplete work, and merge blockers accurately documented in the PR body and applicable labels. Ready-for-review state does not establish approval or permission to merge.
