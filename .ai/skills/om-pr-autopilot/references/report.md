# Report — publishing the complete information

Two outputs, same content: one **summary comment on the PR** (so the state is
readable on GitHub without the session) and the **session report**. Write full
sentences that explain the why behind each outcome — never a compressed
key:value dump.

## 1. Summary comment on the PR

Post once per run via **comment-pr**. When a previous `om-pr-autopilot` comment
exists, update it instead of stacking duplicates (**list-issue-comments** →
**update-comment**). When the tracker descriptor defines no **update-comment**
operation, post a replacement comment that states it supersedes the previous
`om-pr-autopilot` report — never silently stack a second one.

```markdown
🤖 `om-pr-autopilot` run — {UTC timestamp}

**Diagnosis on entry**

{the PR State Report from references/diagnose.md}

**Chain executed**

| Step | Skill | Outcome |
|---|---|---|
| 1 | `om-auto-continue-pr` | Finished plan steps 2.3–2.5; 3 commits pushed |
| 2 | `om-auto-fix-pr` | Review approvable after 1 autofix cycle; CI green |
| 3 | `om-auto-qa-pr` | 4 screenshots attached; order flow verified |

**State now**

- Review: {verdict, and by whom}
- CI: {green / which checks are red and why}
- Mergeability: {status}
- QA: {evidence, or what is still missing}
- Follow-ups filed: {#issue links, or none}

**Labels this PR should carry**

`{pipeline}` · `{category}` · `{meta}` · `{priority}` · `{risk}`

{Applied automatically | ⚠ This account has no triage rights (403) — @maintainer, please apply the set above.}

**Verdict:** {merge-ready | blocked on X | waiting for QA sign-off | needs a human decision on Y}
```

## 2. Label set

Derive the full intended set from the diff and `AGENTS.md` → PR Workflow:

- **pipeline** (exactly one): `review` while under review, `changes-requested`
  on a failed review, `merge-queue` when approved and green, `blocked` on a
  genuine blocker. **Never set `qa`** — that label is driven manually by QA
  reviewers only.
- **category** (additive): `bug`, `feature`, `refactor`, `security`,
  `dependencies`, `enterprise`, `documentation`.
- **meta**: `needs-qa` for UI/customer-facing behavior, `skip-qa` for
  docs/deps/CI/test-only. Never both. `screenshots` when UI evidence was posted.
- **priority** (exactly one, inferred when absent): outage/data-loss/security
  incident → `priority-extreme`; security hardening, release-blocking regression,
  auth/session/tenant-scope/money/event-reliability → `priority-high`; ordinary
  fix or feature → `priority-medium`; cosmetic/docs/deps/cleanup →
  `priority-low`. Conflicting signals → the higher one, and say why.
- **risk** (exactly one, inferred when absent): auth/session/tenant-scope/money,
  migrations/schema, encryption, event reliability, shared contract surfaces, or
  broad cross-module edits → `risk-high`; ordinary single-module change with
  tests → `risk-medium`; docs/deps/test-only/typo/cosmetic → `risk-low`.

Every label the run adds or changes needs a one-line reason in the comment —
that is the repo's label-rationale rule.

**403 fallback:** an account without triage rights cannot apply labels. Do not
retry or work around it: list the intended set in the comment, address the
maintainer, and note it in the session report as an open item.

## 3. Session report

Same content, plus what the comment cannot carry: the commands run, files
touched per step, and anything that needed a judgment call. End with the
chaining reference lines so a following skill can consume them:

```text
PR: #{number} (link: {url})
Issue: #{number} (link: {url})   ← only when the run has a subject issue
```

## 4. What the report must never claim

- Never report a gate as passed that was not actually run — name every skipped
  step and why it was skipped.
- Never claim QA passed without attached evidence.
- Never report "merged" unless `--allow-merge` was passed and the merge really
  happened.
