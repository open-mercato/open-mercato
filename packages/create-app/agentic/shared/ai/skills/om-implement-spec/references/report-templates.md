# Interactive Implement-Spec Report Templates

Use this structure for complete, partial, and blocked local runs. Write full sentences that explain why each state was reached; do not compress the report into a key/value log.

```markdown
## 🎯 om-implement-spec — {spec title or slug}

**Outcome:** {✅ selected phases implemented and verified | 🔁 partial | ⛔ blocked} — {what was delivered or what stopped and why}
**📝 Spec:** `{repo-relative spec path}` — {how it was resolved and what selected phases cover}
**Selected phases:** {phase IDs/names} — {why these were the confirmed boundary}

### 📋 Plan & progress
{Summarize the confirmed goal, scope, non-goals, completed slices/acceptance IDs, current phase states, and remaining work. Name where Implementation Status was updated.}

### 🧪 Validation & 🔍 review
{List exact focused and configured commands with results, integration paths exercised, the om-code-review verdict, follow-up fixes/revalidation, and any honest blocker.}

### 📸 UI verification
{Describe affected routes/states/themes/widths/keyboard flows exercised and local evidence, `UI: n/a` with a reason, or the missing verification that keeps the phase open.}

### {✅ Done | 🔁 Next | ⛔ Blocked}
{Complete: what is ready for the user's next workflow. Partial: the next pending slice/phase and the confirmation needed. Blocked: the exact decision or failing gate required to resume.}

Spec: <repo-relative spec path>
```

The final `Spec:` line is always present, exact, undecorated, and last so a later workflow can consume it. This local interactive skill must never emit `PR:` or `Issue:` reference lines or claim branch/tracker state; those belong to PR automation skills. If the user separately asks for a PR, finish this report first and hand the exact `Spec:` reference to `om-auto-implement-spec` or the requested delivery workflow.
