# Execution plan — complete MCP tool-annotation review fixes (adopted from PR #5322)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-20 because PR #5322 carried no execution plan.
**PR:** #5322 · **Branch:** `fix/issue-5283-mcp-readonly-annotations` · **Base:** `develop`
**Author:** @Paul-Mlodochowki — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Publish correct MCP tool annotations and address every actionable finding from the PR's code review.

## Scope

MCP tool metadata, its client/server coverage, and the authoring guidance that governs mutation declarations.

## Non-goals

No change to MCP authorization semantics, API execution behavior, or unrelated documentation.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The annotation implementation is complete. | PR description and commit `f9586eae`. | high |
| Documentation must make mutation declarations safe to copy. | Review M1 by @pkarw. | high |
| The remaining Low findings should be resolved with focused code and tests. | Review L1–L4 by @pkarw and user request. | high |

## Assumptions

The user's request to fix the review findings authorizes adoption and execution of this narrow plan without a separate confirmation.

## Risks

MCP annotations guide external approval behavior, so tests must preserve the conservative defaults.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Publish derived MCP annotations across tools/list surfaces — f9586eae

### Phase 2: Address review findings

- [ ] 2.1 Document `isMutation` as the source of MCP approval metadata
- [ ] 2.2 Preserve the complete MCP annotation shape and document Code Mode's approval-path exception
- [ ] 2.3 Add focused coverage for every annotation transport surface

### Phase 3: Verify and hand off

- [ ] 3.1 Run targeted validation, review the diff, and update the PR
