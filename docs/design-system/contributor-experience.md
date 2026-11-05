# O. Contributor Experience (CX) Design

> Contributor journey maps, pain points, cheat sheet, error messages, feedback loops.

---


### O.1 Contributor Journey Map

#### Step 1: Discovery — "What components exist?"

| | Current state (without DS) | Target state (with DS) |
|---|---|---|
| **What they do** | Browse `packages/ui/src/primitives/`, grep "import.*from.*ui", open the customers module and read code | Open `packages/ui/DS.md`, scan the component list |
| **What they look for** | "Is there a component for status?" "What is Notice vs Alert?" | Component list with a one-line description and link |
| **What can go wrong** | Find Notice AND Alert, don't know which to use. Build their own. | See clearly: "Alert (unified) — use this. Notice is deprecated." |
| **How DS helps** | — | Single entry point with a component list, searchable, with "when to use" |

#### Step 2: Decision — "Which component should I use?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Compare 3-4 modules, look at how others solved the problem. Copy from the one that looks most recent. | Check the decision tree in DS docs: "Displaying a status? -> StatusBadge. A data list? -> DataTable. A form? -> CrudForm." |
| **What can go wrong** | Copy from a module that has legacy patterns (hardcoded colors). Now legacy has propagated to a new module. | Decision tree points to the correct component. Template from K.1 provides ready-to-use code. |
| **How DS helps** | — | Decision tree + "Use This Not That" table (Notice -> Alert, raw table -> DataTable) |

#### Step 3: Implementation — "How do I use this?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Open the customers module, copy page.tsx, modify. Unaware of EmptyState, unaware of StatusBadge. | Copy the template from K.1, rename entities. TypeScript auto-suggests props. |
| **What can go wrong** | Forget the empty state (79% of pages). Use hardcoded colors (copied from an old module). | Template includes EmptyState. Lint rule catches hardcoded colors. |
| **How DS helps** | — | Templates with built-in best practices + lint rules as a safety net |

#### Step 4: Self-check — "Did I do it right?"

| | Current state | Target state |
|---|---|---|
| **What they do** | `yarn lint` (catches only TypeScript/ESLint basics). Visually inspect in the browser. | `yarn lint` catches DS violations. 10-question self-check from M.3. |
| **What can go wrong** | Lint does not catch a missing EmptyState. Contributor doesn't know they should check dark mode. | 6 DS lint rules give concrete feedback. Self-check reminds about dark mode. |
| **How DS helps** | — | Lint rules + self-check checklist + ds-health-check.sh on their module |

#### Step 5: PR review — "What does the reviewer check?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Wait 1-3 days for review. Reviewer comments: "change the color", "add empty state", "use apiCall". 2-3 rounds. | Lint caught 80% of issues before the PR. Reviewer checks logic and UX, not colors. 1 round. |
| **What can go wrong** | Reviewer doesn't know DS guidelines — lets hardcoded colors through. Or: reviewer is too strict — contributor gets discouraged. | PR template with DS checklist (from section E). Reviewer has clear criteria — not "my opinion" but "DS standard". |
| **How DS helps** | — | PR template + reviewer checklist + lint pre-screening |

#### Step 6: Post-merge — "How do I learn for next time?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Nothing. Review feedback is lost in a closed PR. Next time they repeat the same mistakes. | DS entry point has a "Common Mistakes" section (M.4). Monthly digest highlights recurring issues. |
| **What can go wrong** | Tribal knowledge — contributor #2 never sees feedback from contributor #1's PR. | Feedback from reviews is generalized in DS docs. Anti-patterns (M.4) is a living document. |
| **How DS helps** | — | Anti-patterns doc + monthly digest + feedback channel |

### O.2 Single Entry Point

**Decision: `packages/ui/DS.md`** — in the root of the UI package.

Rationale:
- **Not AGENTS.md** — that is for AI agents, not humans. A contributor won't look for DS guidelines in AGENTS.md.
- **Not docs/** — because docs/ is a separate documentation app. DS guidelines must be close to code, not in a separate deploy.
- **Not Storybook** — because we don't have Storybook and setting it up is a separate 2+ day project. Pragmatism > idealism.
- **Why packages/ui/** — because a contributor building UI opens this package anyway. Minimal distance between "searching" and "found".

**Content outline:**

```markdown
# Open Mercato Design System

> Consistency > Perfection. See Section T.4 for our philosophy.

## Quick Start (30 seconds)
Building a new page? Copy a template from `templates/` and customize.

## Component Reference
One-line description + import path for each DS component.
| Component | When to Use | Import |
|-----------|-------------|--------|

## Decision Tree
"What component do I need?" — flowchart from task -> component.

## Tokens
Status colors, typography scale, spacing — link to globals.css with commentary.

## Use This, Not That
| Instead of... | Use... | Why |
Notice | Alert | Notice is deprecated, Alert has all variants
text-red-600 | text-destructive | Semantic token, works in dark mode
raw <table> | DataTable | Sorting, filtering, pagination built-in

## Templates
Links to K.1 templates: list page, create page, detail page.

## Self-Check Before PR
Link to M.3 — 10 questions.

## Anti-Patterns
Link to M.4 — top 5 mistakes.

## Feedback & Questions
GitHub Discussion category "Design System Feedback".
```

**Constraint: 60 seconds to find an answer.** Hence tables, not paragraphs. Links, not duplicated content. Component Reference is max 15 rows — that's how many DS components we have.

### O.3 Lint Error UX

#### 1. `om-ds/no-hardcoded-status-colors`

```
[om-ds/no-hardcoded-status-colors]
❌ Hardcoded color "text-red-600" in className. Status colors must use semantic tokens.
✅ Replace with: "text-destructive" (for text) or "text-status-error-text" (for status context)
📖 See: packages/ui/DS.md#tokens → Status Colors
```

#### 2. `om-ds/no-arbitrary-text-sizes`

```
[om-ds/no-arbitrary-text-sizes]
❌ Arbitrary text size "text-[11px]" detected. Use Tailwind scale or DS tokens.
✅ Replace with: "text-overline" (for 11px uppercase labels) or "text-xs" (for 12px small text)
📖 See: packages/ui/DS.md#tokens → Typography Scale
```

#### 3. `om-ds/require-empty-state`

```
[om-ds/require-empty-state]
❌ Page uses <DataTable> but has no <EmptyState> component.
   79% of existing pages miss this — don't add to the count.
✅ Add conditional EmptyState before DataTable:
   if (!isLoading && rows.length === 0 && !search) return <EmptyState title="..." action={{...}} />
📖 See: packages/ui/DS.md#templates → List Page Template
```

#### 4. `om-ds/require-page-wrapper`

```
[om-ds/require-page-wrapper]
❌ Backend page missing <Page> and <PageBody> wrappers.
   These provide consistent spacing (space-y-6, space-y-4) and page structure.
✅ Wrap your page content:
   <Page><PageBody>{/* your content */}</PageBody></Page>
📖 See: packages/ui/DS.md#templates → any template
```

#### 5. `om-ds/no-raw-table`

```
[om-ds/no-raw-table]
❌ Raw HTML <table> element in backend page. Use DS table components.
✅ For data lists: <DataTable> (sorting, filtering, pagination built-in)
   For simple key-value: <Table> from @open-mercato/ui/primitives/table
📖 See: packages/ui/DS.md#decision-tree → "Displaying data?"
```

#### 6. `om-ds/require-loading-state`

```
[om-ds/require-loading-state]
❌ Page uses apiCall() but has no loading state handler.
   41% of existing pages miss this — users see blank screens during data fetch.
✅ For detail pages: if (isLoading) return <LoadingMessage />
   For list pages: pass isLoading={isLoading} to <DataTable>
📖 See: packages/ui/DS.md#templates → Detail Page Template
```


---

## See also

- [Onboarding Guide](./onboarding-guide.md) — "Your First Module" step-by-step
- [Contributor Guardrails](./contributor-guardrails.md) — templates and scaffolding
- [Champions](./champions.md) — contributor support network
- [Iteration](./iteration.md) — how we collect contributor feedback
