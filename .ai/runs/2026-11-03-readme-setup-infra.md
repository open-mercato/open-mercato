# Simplify the README quickstart after #7865

## Goal and scope
Make the main README use the infrastructure-aware yarn setup entry point introduced by #7865. Remove the redundant manual Compose startup command, explain setup/reuse and the external-services flag. Only README prose and this tracking plan change; no runtime, release or installer behavior changes.

## Validation
Runner: local. Documentation-only gate: whitespace/diff check, shell syntax of the quickstart, and manual comparison against the merged setup scripts. No application tests or builds are needed for prose-only edits.

## Progress

PR: #8608

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Documentation

- [x] 1.1 Simplify the quickstart and document setup reuse and --no-infra. — 387c7017f
- [x] 1.2 Validate the snippet and review the documentation diff. — 387c7017f

### Phase 2: Publish

- [x] 2.1 Record automated review and publish the completed PR. — 4f03ccc1e (review recorded in the PR conversation)
