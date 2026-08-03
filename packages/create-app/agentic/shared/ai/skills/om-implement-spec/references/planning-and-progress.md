# Interactive Planning and Progress

Derive the local execution plan from the resolved spec's approved implementation phases. This is a focused delivery plan, not a second design document.

## Plan contract

Present these fields in order:

1. **Goal** — the selected phases' observable outcome in one sentence.
2. **Scope** — selected phases, acceptance IDs, affected modules/packages, and real call sites.
3. **Non-goals** — later phases and adjacent work that remain untouched.
4. **Source doc:** `{SPEC_PATH}`.
5. **Phase execution** — dependencies, ordered slices, owned files, routed guides/skills, closest references, BC/schema surfaces, test oracles, validation commands, and exit gates.
6. **Risks** — only concrete rewrite, compatibility, data, security, or validation risks.

Present the complete plan to the user before coding and wait for confirmation. If the user changes phase selection or scope, rebuild and re-present the affected plan instead of silently carrying stale assumptions.

## Phase state and progress

Only one phase may be `in_progress`; all dependencies must be `verified`. Add or update the resolved spec's `## Implementation Status` section:

```markdown
## Implementation Status

Source doc: .ai/specs/{spec}.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — {name} | in_progress | none | AC-1, AC-2 | `{command}` | {observable gate} |
| Phase 2 — {name} | pending | Phase 1 | AC-3 | `{command}` | {observable gate} |

### Phase 1 progress

- [x] {slice}: {files/real call sites} — `{command}` passed
- [ ] {remaining slice}: {acceptance IDs and oracle}
```

After every slice, record changed areas, acceptance evidence, the exact focused command/result, and remaining work. Mark a phase `verified` only after `phases-and-gates.md` permits it. A partial or blocked phase stays `in_progress`, and later phases stay `pending`.

Before moving to the next selected phase, show the completed phase evidence and ask to continue unless the user approved the whole selected sequence when confirming the plan. Do not create a separate autonomous run plan, branch, commit, or PR unless the user explicitly invokes the corresponding delivery workflow.
