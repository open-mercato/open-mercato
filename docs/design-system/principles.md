# Part 2 — Design Principles

> 8 design principles for Open Mercato + PR review checklist.

---

## Proposed Design Principles for Open Mercato

### Principle 1: Clarity Over Cleverness

**Definition:** Every UI element should be obvious in its purpose. Zero magic, zero hidden behaviors.

**Elaboration:** In an open source project, contributors have varying experience levels. The interface must be understandable both for the end user and for a developer reading the code. If you need to explain what a component does — it is too complicated.

**Why it matters in OSS:** New contributors must understand UI patterns without mentoring. Clear patterns reduce onboarding time.

**What decisions it supports:**
- Explicit props over magic defaults
- Descriptive naming over abbreviations
- Visible state over hidden state
- Documentation of "why" not just "how"

**Good example:** `<EmptyState title="No customers yet" description="Create your first customer" action={{ label: "Add customer", onClick: handleCreate }} />` — every behavior is visible in props.

**Violation:** A component that changes its behavior depending on the parent context, without a visible prop.

**Impact on contributor:** Can build UI without studying internals.
**Impact on UX:** The user always knows what is happening and why.
**Impact on consistency:** Explicit patterns are easier to replicate.

---

### Principle 2: Consistency Is a Feature

**Definition:** Solve the same problems in the same way. Always.

**Elaboration:** Consistency is not a constraint — it is a product. The user learns patterns once and applies them everywhere. A contributor builds a new module faster because the patterns are familiar.

**Why it matters in OSS:** 34 modules, many contributors. Without consistency every module looks like a separate application.

**What decisions it supports:**
- Use an existing component instead of creating a new one
- Apply the same spacing, colors, typography tokens
- The same CRUD flow in every module
- The same error/success pattern everywhere

**Good example:** Every list of users, products, orders looks and works identically — DataTable with the same filters, actions, pagination.

**Violation:** A portal signup page with a hand-built form using different spacing and labels than the rest of the system.

**Impact on contributor:** Fewer decisions = faster building.
**Impact on UX:** The user feels "at home" in every module.
**Impact on consistency:** Eliminates design debt before it forms.

---

### Principle 3: Accessible by Default

**Definition:** Accessibility is not an add-on or a checklist item. It is built into every component from the start.

**Elaboration:** A component without aria-label is not "almost ready" — it is incomplete. The DS must guarantee that by using components from the system, a contributor automatically delivers accessible UI.

**Why it matters in OSS:** Diverse contributors have varying a11y awareness. The system must enforce good practices.

**What decisions it supports:**
- Required `aria-label` on IconButton (enforced by TypeScript)
- Semantic HTML as default (not `<div>` with onClick)
- Focus management in every interactive component
- Color contrast checked at the token level
- Keyboard navigation as part of the definition of "done"

**Good example:** `<IconButton aria-label="Delete customer">` — TypeScript error if aria-label is missing.

**Violation:** 370+ interactive elements without aria-label in the current codebase.

**Impact on contributor:** Does not need to remember about a11y — the system enforces it.
**Impact on UX:** The product is usable for everyone.
**Impact on consistency:** Accessibility rules are part of the design system contract.

---

### Principle 4: Reuse Over Reinvention

**Definition:** Do not build what already exists. Extend existing components instead of creating new ones.

**Elaboration:** Every new component is a maintenance cost. In OSS that cost is spread across many maintainers. The fewer components, the easier they are to maintain, test, and document.

**Why it matters in OSS:** Duplication is a natural effect of decentralized contribution. 15+ Section components in Open Mercato are proof.

**What decisions it supports:**
- Check existing components before building a new one
- Use composition (children, slots) instead of creating variants
- One Alert component instead of Notice + Alert + ErrorNotice
- One way to display statuses instead of hardcoded colors per module

**Good example:** Using `<DataTable>` with customization instead of building a custom list.

**Violation:** `Notice` and `Alert` — two components doing the same thing with different APIs and colors.

**Impact on contributor:** Less to learn, less to maintain.
**Impact on UX:** Consistent feedback behavior.
**Impact on consistency:** Reduces the system's surface area.

---

### Principle 5: Predictable Behavior

**Definition:** The user should be able to predict UI behavior before clicking. No surprises.

**Elaboration:** If the "Delete" button in one module shows a confirmation dialog, it must do so in every module. If `Escape` closes a form, it must close every form.

**Why it matters in OSS:** Different contributors may implement the same pattern differently. The system must guarantee consistent behavior.

**What decisions it supports:**
- Destructive actions always require confirmation
- Keyboard shortcuts are global and consistent
- Loading states are always visible
- Error messages always appear in the same place

**Good example:** `Cmd/Ctrl+Enter` submit in every form, `Escape` cancel — unified by CrudForm.

**Violation:** An auth login form that does not handle `Escape` to cancel.

**Impact on contributor:** Clear rules = fewer edge cases to handle.
**Impact on UX:** The user builds muscle memory.
**Impact on consistency:** Behaviors are part of the system, not part of a module.

---

### Principle 6: System Thinking

**Definition:** Every component is part of a larger system. Do not design in isolation.

**Elaboration:** Changing a button color affects contrast with the background, text readability, dark mode, alert states. Changing the spacing of one component affects the layout of the entire page. Think about dependencies.

**Why it matters in OSS:** A contributor sees their PR, not the entire system. The design system must enforce system thinking.

**What decisions it supports:**
- Use tokens instead of hardcoded values
- Test changes in the context of the entire page, not just the component
- Understand dependencies between components
- Document side effects of changes

**Good example:** Changing the `--destructive` color token automatically updates all error states in the system.

**Violation:** 372 hardcoded colors — changing the "error" semantics requires editing 159 files.

**Impact on contributor:** A change in one place propagates correctly.
**Impact on UX:** A consistent system without "holes".
**Impact on consistency:** The system is self-reinforcing.

---

### Principle 7: Progressive Disclosure

**Definition:** Show only what is needed now. The rest is available on demand.

**Elaboration:** A form with 30 fields is overwhelming. A table with 20 columns is unreadable. Show the minimum, let the user reveal more when needed.

**Why it matters in OSS:** New contributors add fields "just in case". The system must encourage minimalism.

**What decisions it supports:**
- Default column set in DataTable (5-7 columns), the rest in column chooser
- Grouped form fields with collapsible sections
- Summary view → detail view pattern
- Advanced filters hidden behind a "More filters" trigger

**Good example:** DataTable with column chooser — 5 columns by default, the user adds more.

**Violation:** A form with 20 visible fields without grouping.

**Impact on contributor:** Clear guidelines on how many fields/columns is "too many".
**Impact on UX:** Lower cognitive load.
**Impact on consistency:** All lists and forms have similar information density.

---

### Principle 8: Contribution-Friendly Design

**Definition:** The design system must be easy to use and hard to break.

**Elaboration:** A contributor should be able to build a consistent screen using 5-10 components, without reading 100 pages of documentation. TypeScript should catch errors before they reach PR review.

**Why it matters in OSS:** A design system for a closed team can rely on tribal knowledge. OSS must be self-documenting.

**What decisions it supports:**
- Simple component APIs (few required props, sensible defaults)
- TypeScript enforcement (required aria-label, required variant)
- Component templates instead of building from scratch
- Good error messages in dev mode
- A reference example (customers module)

**Good example:** `<CrudForm fields={[...]} onSubmit={fn} />` — the contributor provides fields and a submit handler, everything else is automatic.

**Violation:** A component with 25 props, 15 of which are required.

**Impact on contributor:** Quick start, hard to make mistakes.
**Impact on UX:** Every contributor delivers similar quality UI.
**Impact on consistency:** The system enforces good practices instead of relying on them.

---

## Short version of principles (for README)

```
## Design Principles

1. **Clarity Over Cleverness** — Every UI element should be obvious in purpose
2. **Consistency Is a Feature** — Same problems, same solutions, always
3. **Accessible by Default** — A11y is built-in, not bolted-on
4. **Reuse Over Reinvention** — Extend existing components, don't create new ones
5. **Predictable Behavior** — Users should predict UI behavior before clicking
6. **System Thinking** — Every component is part of a larger system
7. **Progressive Disclosure** — Show what's needed now, reveal more on demand
8. **Contribution-Friendly** — Easy to use correctly, hard to use wrong
```

## Design Review / PR Review Checklist (based on principles)

### Clarity
- [ ] Does the component have an obvious purpose without reading documentation?
- [ ] Are prop names descriptive and unambiguous?
- [ ] Are states (loading, error, empty) explicitly handled?

### Consistency
- [ ] Are existing tokens used (colors, spacing, typography)?
- [ ] Is the CRUD flow identical to other modules?
- [ ] Does error/success feedback use the same components?
- [ ] Is spacing consistent with the system scale?

### Accessibility
- [ ] Does every interactive element have an aria-label or visible label?
- [ ] Is semantic HTML used (button, nav, heading)?
- [ ] Is the component keyboard navigable?
- [ ] Is the contrast ratio sufficient?

### Reuse
- [ ] Were existing components checked before building a new one?
- [ ] Is logic from another component not duplicated?
- [ ] Is composition used instead of a new variant?

### Predictability
- [ ] Do destructive actions have a confirmation dialog?
- [ ] Are keyboard shortcuts consistent with the rest of the system?
- [ ] Does the user know what will happen after clicking?

### System Thinking
- [ ] Are design tokens used instead of hardcoded values?
- [ ] Does the change work correctly in dark mode?
- [ ] Does the component work correctly in different contexts (modal, page, sidebar)?

### Progressive Disclosure
- [ ] Does the form have no more than 7-10 visible fields?
- [ ] Does the table have no more than 7 default columns?
- [ ] Are advanced options hidden behind a trigger?

### Contribution-Friendly
- [ ] Can a new contributor use the component without mentoring?
- [ ] Does TypeScript catch common errors?
- [ ] Is there a usage example (in the customers module or Storybook)?

---

---

## See also

- [Audit](./audit.md) — audit data on which principles are based
- [Foundations](./foundations.md) — token and scale implementation
- [Enforcement](./enforcement.md) — enforcing rules in CI/PR
- [Contributor Guardrails](./contributor-guardrails.md) — module templates
