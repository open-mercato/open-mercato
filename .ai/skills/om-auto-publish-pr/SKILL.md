---
name: om-auto-publish-pr
description: Publish pkg.pr.new package previews for a same-repository Open Mercato PR by dispatching the Package Previews GitHub Actions workflow with gh. Use when a maintainer asks to publish, republish, or trigger a PR package preview. Does not publish npm snapshots.
---

# Auto Publish PR Preview

Dispatch the `Package Previews` workflow for a PR. This publishes pkg.pr.new previews only; do not invoke `NPM Snapshot Preview` from this skill.

## Arguments

- `{pr_number}` (required) - Pull request number to publish previews for.
- `--repo <owner/name>` (optional) - Defaults to the current repository.
- `--ref <branch>` (optional) - Workflow definition ref. Default: `develop`.

## Procedure

1. Resolve inputs and confirm the PR exists:

```bash
REPO="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
PR_NUMBER="{pr_number}"
WORKFLOW_REF="${WORKFLOW_REF:-develop}"

gh pr view "$PR_NUMBER" --repo "$REPO" \
  --json number,title,headRepositoryOwner,headRefName,headRefOid,isCrossRepository
```

2. If `isCrossRepository` is `true`, stop. The workflow rejects fork PRs because it runs publish-capable automation from a trusted workflow context.

3. Dispatch the preview workflow:

```bash
gh workflow run package-previews.yml \
  --repo "$REPO" \
  --ref "$WORKFLOW_REF" \
  -f "pr_number=$PR_NUMBER"
```

4. Find the newest run for the workflow and report it:

```bash
sleep 3
gh run list \
  --repo "$REPO" \
  --workflow package-previews.yml \
  --limit 5
```

5. Final response must include:

- PR number and title.
- The workflow ref used.
- The dispatch command result.
- The newest relevant run URL when available.

## Guardrails

- Do not commit, push, label, or merge anything.
- Do not dispatch `npm-snapshot-preview.yml`; that is intentionally a separate manual path.
- If the workflow is not found on `develop`, tell the user to pass `--ref <branch-with-workflow>` or wait until the workflow change is merged.
