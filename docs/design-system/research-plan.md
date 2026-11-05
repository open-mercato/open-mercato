# Q. Guerrilla Research Plan

> Lightweight research methods: PR archaeology, 5-minute tests, unmoderated tasks, intercept surveys.

---


### Q.1 "5 Questions, 3 People, 15 Minutes"

**Who to ask:**
1. An active module maintainer (>=10 PRs, knows the codebase)
2. An occasional contributor (2-5 PRs, knows fragments)
3. A potential contributor (follows the repo, may have opened 1 issue, hasn't committed yet)

**How to conduct: Async survey via GitHub Discussion.**

Rationale: A synchronous call requires timezone coordination and discourages introverted contributors. A Discussion post with questions lets people respond when they have 10 minutes. Additionally: responses are public, which sets a precedent for open communication about the DS.

**5 questions:**

1. **"When you last built a new screen (or modified an existing one) — how did you know which components to use? What did you open first?"**
   Goal: Discover the discovery path. Do they grep? Copy from another module? Ask someone?

2. **"Has it ever happened that a reviewer asked you to change a color, spacing, or component in your PR? If so — did you understand why the change was needed?"**
   Goal: Measure review friction and understand whether contributors understand the rules or just follow orders.

3. **"If tomorrow you had to build a list page with a table, statuses, and an empty state — where would you start? Which module would you open as a reference?"**
   Goal: Discover which module is the de facto reference (it might not be customers!) and what the contributor's mental model looks like.

4. **"What is the most annoying thing about building UI in Open Mercato? One specific thing."**
   Goal: Uncover a friction point invisible in the code audit. Maybe it's lack of hot reload, maybe a slow build, maybe unclear code navigation.

5. **"If you could change one thing about how the Open Mercato UI looks or works — what would it be?"**
   Goal: Validate priorities. If 3/3 people say "dark mode is broken" — we know semantic tokens are the right priority. If they say "no mobile view" — we know our priorities may need adjustment.

**Template for results summary (1 page):**

```markdown
## DS Research Summary — [date]

### Participants
- [persona 1]: [module/role], [number of PRs]
- [persona 2]: ...
- [persona 3]: ...

### Key Findings
1. **Discovery path:** [how they find components — e.g. "2/3 copy from customers"]
2. **Review friction:** [how many rounds, do they understand rules — e.g. "nobody knew about semantic tokens"]
3. **Reference module:** [which module they consider exemplary]
4. **Top friction point:** [what annoys them most]
5. **Top wish:** [what they would change]

### Impact on DS Plan
- [What we confirm — e.g. "semantic tokens are the right priority #1"]
- [What we change — e.g. "add hot reload to hackathon scope because 2/3 people complained"]
- [What we add — e.g. "need to document why customers, not sales, is the reference"]
```

### Q.2 Hallway Testing — component API

**Task for the contributor (literal text):**

> I have a TypeScript interface for a new FormField component. Without looking at the documentation — write JSX that renders a form with 3 fields: Name (text, required), Email (text, with description "We'll never share your email"), Status (select, with error "Status is required"). You can use any components inside FormField. You have 3 minutes.

```typescript
// Give this to the contributor:
interface FormFieldProps {
  label?: string
  id?: string
  required?: boolean
  labelVariant?: 'default' | 'overline'
  description?: string
  error?: string
  orientation?: 'vertical' | 'horizontal'
  disabled?: boolean
  children: React.ReactNode
}
```

**What to observe (rubric):**

| Aspect | Success (5 pts) | Issues (3 pts) | Failure (1 pt) |
|--------|----------------|-------------------|-----------------|
| **Understanding children pattern** | Immediately places `<Input>` as children | Asks "is this a slot?" but understands after a moment | Tries to pass input as a prop |
| **Required indicator** | Uses `required={true}` and expects the label to change | Manually adds an asterisk to the label | Doesn't know how to mark a field as required |
| **Error handling** | Passes `error="..."` and does not add manual error display | Asks "does the error display automatically?" | Adds a manual `<span className="text-red-600">` below the field |
| **Naming intuition** | Doesn't ask about any prop name | Asks about 1 prop name | Asks about >=3 prop names |
| **Time** | <2 min | 2-3 min | >3 min or doesn't finish |

**If contributor scores <=3 on "children pattern":** Consider changing the API to an `input` prop instead of `children`. If >=4 on all: the API is intuitive.

### Q.3 Observation Protocol — "Watch One, Do One"

**When: AFTER the hackathon** (week 2). Rationale: We want to validate whether DS artifacts (templates, tokens, lint rules) work in practice, not in theory.

**Setup:**

> "Imagine that the Sales module needs a new page: a list of warranties with a table, statuses (active/expired/pending), an empty state, and the ability to create a new warranty. Build the list page. You have 30 minutes. You can use any files in the repo. Tell me out loud what you're doing — e.g. 'I'm opening customers to see the reference'. Don't ask me for help — do it as you would on your own."

**Observation — what to note:**

| Time | Note |
|------|----------|
| 0:00-2:00 | **Where they search:** Open DS.md? Customers module? Grep? Google? |
| 2:00-5:00 | **What they copy:** Which template/module? Do they use K.1? |
| 5:00-15:00 | **Where they get stuck:** Import paths? Token names? StatusBadge API? EmptyState props? |
| 15:00-25:00 | **What they skip:** Do they add EmptyState? Loading state? useT()? metadata? |
| 25:00-30:00 | **Did lint help:** Do they run lint? Did lint catch problems? |

**Observation rule:** Do not help, do not comment, do not nod approvingly. Take notes. The only exception: if the contributor is blocked for >3 min on the same thing, you may say "move on, we'll come back to that".

**Debrief (3 questions):**

1. "What was the easiest part of building this page?"
2. "Where did you get stuck the longest — and why?"
3. "If you could change one tool/file/component to make this faster — what would it be?"


---

## See also

- [Success Metrics Beyond Code](./success-metrics-cx.md) — metrics informed by research
- [Iteration](./iteration.md) — feedback cycle based on research findings
- [Champions](./champions.md) — champions as a source of insights
