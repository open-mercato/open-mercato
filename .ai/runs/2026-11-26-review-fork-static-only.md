# Keep untrusted PR review off the maintainer runtime

Refs #10683

## Goal

Apply a trust check to Open Mercato's local review workflow before any PR-head checkout or command. Use the GitHub diff and checks for fork or otherwise untrusted heads.

## Scope and risks

Change the tracked review-skill overrides for the Open Mercato repository. Validate their shared policy, including reviews started by the batch runner. Review the upstream shared collection separately if it still allows unsafe local execution.

## Progress

PR: #10807

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Defensive review policy

- [x] 1.1 Document the trusted metadata and static-review path in both overrides — d718fa0309
- [x] 1.2 Review the resulting workflow and record verification — d718fa0309
