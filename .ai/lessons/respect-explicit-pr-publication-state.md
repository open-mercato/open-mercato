---
title: "Respect explicit PR publication state"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["pull-requests","user-instructions","validation"]
---

# Respect explicit PR publication state

**Context**: PR #7661 was left as a draft after unrelated full-gate failures. The user clarified that this project accepts only ready-for-review pull requests.

**Rule**: Publish pull requests ready for review under the explicit no-drafts policy, including when a generic skill would create or retain a draft. Keep failing validation, incomplete work, and merge blockers accurately documented in the PR body and applicable labels. Ready-for-review state does not establish approval or permission to merge.

Use companion skills from the same collection as the explicitly invoked entrypoint, together with the repository overrides. Do not mix that chain with a different global installation's publication or review contract.

Keep author validation separate from reviewer decisions. A local test failure or an author's `COMMENTED` note does not establish a changes-requested review. When formal review cannot be submitted, the chain's fallback is `review`; document validation limits and pending CI without inventing approval or changes-requested feedback. Use the repository's CI-first rule when current-head checks are running.
