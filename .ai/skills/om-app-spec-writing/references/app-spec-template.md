# App Spec template

The document skeleton `om-app-spec-writing` instantiates at Phase 0 and fills phase by phase; each section's checklist is that phase's done condition. Everything below the divider is the template — copy it verbatim into the new App Spec file and replace the bracketed placeholders. Owner tags: `PM` (the product-manager persona driving the spec), `Architect` (platform mapping and gap analysis), `UX` (clarity and task completion), `DDD` (the challenger).

---

# App Spec: [App Name]

> The App Spec is a business architecture document that sits above feature specs.
> It captures domain knowledge, validates cross-spec consistency, and ensures
> the app solves a real business problem using the platform correctly.
>
> This document is the SINGLE SOURCE OF TRUTH for what this app is, who it serves,
> and how it maps to the platform. Feature specs are generated from this document.
> If a spec contradicts this document, this document wins.
>
> Each section has a checklist with an owner. A section is done when all checks pass.

---

## 1. Business Context `PM`

### 1.1 Business Model

[Describe: what the app does, how the business makes money, who pays.]

**Flywheel:**
```
[Draw the reinforcing loop that makes the system more valuable over time]
```

#### Checklist
- [ ] Paying customer identified — who writes the check? What do they get?
- [ ] Flywheel articulated — the reinforcing loop, not just "users benefit"

### 1.2 Business Goals

**Primary goal:** [What problem does this app solve? For whom?]

**Secondary goal (reference app):** [If applicable — what platform patterns does this app teach?]

**What is NOT important:** [Explicit scope exclusions. What this app will NOT do.]

#### Checklist
- [ ] Primary goal stated with measurable outcome
- [ ] Scope exclusions listed — what's out and why

### 1.3 Ubiquitous Language

> DDD: one term = one meaning everywhere. This glossary IS the ubiquitous language.

| Term | Definition | Source of data | Period |
|------|-----------|----------------|--------|
| | | | |

#### Checklist
- [ ] Every domain term defined once
- [ ] Same word = same meaning across all specs and conversations
- [ ] Source of data specified per term; period specified for time-windowed terms (metrics, KPIs) — N/A otherwise

### 1.4 Domain Model

> DDD: document the domain entities, rules, invariants, and value calculations specific to this app.
> Structure this section however the domain demands — there is no fixed format.
>
> Examples of what belongs here (depending on the domain):
> - Tier/level definitions with thresholds and governance rules
> - KPI formulas with anti-gaming rules
> - Business rules: permissions hierarchy, data ownership, cross-org visibility
> - Domain invariants: what must always be true
> - Value calculations: how scores, ratings, or statuses are derived
> - Entity field definitions with types, constraints, and relations

[Document your domain model here. Use subsections as needed.]

#### Checklist
- [ ] Domain entities identified with clear ownership
- [ ] Domain rules documented — invariants, constraints, calculations
- [ ] If there are levels/tiers: thresholds, benefits, governance rules (evaluation, grace period, downgrade, audit)
- [ ] If there are KPIs/scores: complete formulas with input source, period, anti-gaming rules
- [ ] Access control rules documented — who sees/does what, cross-org visibility
- [ ] Data ownership per entity — who creates, who reads, who updates, system vs user
- [ ] **Entity fields defined precisely** — every domain entity has its fields listed with: key, type (text/select/dictionary/relation/boolean/integer/float), multi-value or not, and required-for-creation flag. Vague descriptions like "company profile data" or "case study information" are not acceptable — implementation will guess wrong.

> **Weak vs precise field definitions:**
>
> | Weak (will cause bugs) | Precise (implementation-ready) |
> |----------------------|-------------------------------|
> | "Case study has industry and tech info" | `industry` (dictionary, multi, required), `technologies` (dictionary, multi, required), `project_type` (select) |
> | "Company profile with services" | `services` (dictionary, multi), `industries` (dictionary, multi), `team_size_bucket` (select) |
> | "Budget information" | `budget_known` (boolean), `budget_bucket` (select, required), `budget_min_usd` (float), `budget_max_usd` (float) |
> | "Track deal progress" | `registered_at` (datetime, system-set, immutable once stamped, UTC) |
> | "License deal record" | `license_identifier` (text, required), `attributed_partner_id` (relation, required), `status` (select), `is_renewal` (boolean), `closed_at` (datetime) — unique key: `(license_identifier, year)` |
>
> Rule of thumb: if a person reading the field definition has to ask "what type is this?" or "is this required?" — the definition is too vague.

---

## 2. Identity Model `PM`

> SINGLE SOURCE OF TRUTH. If any spec contradicts this, update the spec.

| Persona | Role key | Identity | Org scope | Sees | Does |
|---------|----------|----------|-----------|------|------|
| | | internal / external | | | |

**External-surface decision framework:**

> Applies when the app distinguishes an internal surface (an admin backend or equivalent — whatever the repo's agent docs name) from a dedicated external one. When the app has a single authenticated surface, record that fact and the roles (if any) here, skip the tree, and mark the rest of this framework N/A.

Every persona external to the operating organization is a candidate for an external identity + a dedicated external surface (portal), instead of an account on the internal surface.

```
External persona?
├─ NO → internal user + internal surface + the app's access-control mechanism
└─ YES → needs brand separation or a different UX than the internal surface?
          ├─ NO, the internal surface is fine → internal user + internal surface
          └─ YES → external identity + dedicated external surface (portal)
```

> **Portal red flag:** if a portal persona needs the internal surface's rich building blocks (data grids, pipeline views, bulk CRUD over many entities) — reconsider; the external surface usually lacks them. Exception: a conscious custom-UX decision recorded in the decision log.
>
> **Internal-surface red flag:** if an internal persona is external to the organization, temporary, and sees 2–3 simple views — consider the external surface instead; the identity model stays clean.
>
> **Agentic cost note:** external-surface pages are custom pages the agent generates from this spec. That is not a blocker — but §3.5 MUST spec every such page with enough detail to implement without guessing. Each page = minimum 1 atomic commit in §4 gap analysis.

**Portal decision:** [USED / NOT USED]

**If USED — per persona justification:**

| Portal persona | Why the external surface, not the internal one? | Custom pages needed? |
|---|---|---|
| | | |

**If NOT USED — why:**
[Justification — e.g., "All personas need the internal tooling. One identity system is simpler."]

**Decision log:**
[Per persona: why this identity type? What capabilities do they need? What was the alternative and why was it rejected?]

#### Checklist
- [ ] Every persona has ONE identity type — internal or external, no "maybe both" `PM`
- [ ] Identity decision justified per persona — the capabilities they need drive the choice `PM`
- [ ] No persona has two accounts — if someone needs both identity types, the model is wrong `Architect`
- [ ] Org scoping defined per role — who sees which orgs, read-only vs read-write `Architect`
- [ ] Portal decision justified with the decision tree (or the single-surface fact recorded) — not just "used/not used" `PM`
- [ ] If Portal USED: every portal persona has a custom-page estimate `Architect`
- [ ] If Portal USED: §3.5 includes the Portal Pages subsection with full page specs `PM`

---

## 3. Workflows `PM`

> Each workflow traces to ROI. If a workflow doesn't move a KPI or enable one that does, cut it.

### WF[N]: [Workflow Name]

**Journey:** [step1] -> [step2] -> ... -> [value delivered]

**ROI:** [Specific measurable business outcome]

**Key personas:** [Who's involved at each step]

**Boundaries:**
- Starts when: [trigger]
- Ends when: [completion criteria]
- NOT this workflow: [what's explicitly out of scope]

**Edge cases:**
1. [scenario] -> [what should happen] -> [risk if unhandled]
2. ...

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| | | | |

[Repeat per workflow]

#### Checklist (per workflow)
- [ ] End-to-end journey — first touchpoint to value delivery, no gaps `PM`
- [ ] Measurable ROI — a specific metric that moves, not "users benefit" `PM`
- [ ] Boundaries — explicit start, end, and NOT-this-workflow `PM`
- [ ] 3–5 edge cases — high-probability production scenarios `PM`
- [ ] Every step mapped to a platform capability `Architect`

#### Checklist (overall)
- [ ] 3–7 core workflows defined `PM`
- [ ] Any workflow needing >200 lines of new code was re-checked against the agent docs for a missed platform capability — and its size justified when none exists `Architect`

---

## 3.5 UI Architecture `PM + UX`

> Defines what each persona sees in the UI: navigation, pages, dashboard widgets, key user flows.
> The PM drafts from user stories; UX reviews for clarity and task completion.
> Everything here uses the platform's existing UI building blocks — no custom components unless flagged.

### Navigation (per role)

> What sidebar groups and items does each role see? Order matters — most-used first.

| Role | Sidebar groups | Notes |
|------|---------------|-------|
| | | |

### Dashboard Widgets (per role)

> What does each role see on their dashboard after login? Widgets should answer "what do I need to do right now?"

| Widget | Roles that see it | Data shown | Click-through |
|--------|------------------|------------|---------------|
| | | | |

### Custom Pages

> Pages beyond the platform's standard CRUD surfaces, using the page conventions from the repo's agent docs.

| Page | URL pattern | Role | Purpose | Building block |
|------|------------|------|---------|----------------|
| | | | | standard form / standard table / custom |

### Portal Pages (when §2 Portal = USED)

> External-surface pages are custom pages; the platform's standard grids and forms are not available there.
> The agent generates them from this spec — it MUST be precise enough to implement without guessing.

| Page | URL pattern | Portal role | Purpose | User actions | Stage gate | Building block |
|------|------------|-------------|---------|--------------|------------|----------------|
| | | | What the user accomplishes | What they can do | Stage/lifecycle condition, or "always" | dashboard widget / custom page / menu injection / form |

> **Stage gate:** the page is available only at certain workflow/lifecycle stages. If always available, write "always".
> Disabled pages show an explanation tooltip — never hidden (preserve spatial memory).
>
> **Rules:**
> - Each page = minimum 1 atomic commit in §4 gap analysis. Estimate per page based on: data-fetching complexity, form validation, real-time events, role-conditional content.
> - If a page uses real-time updates: list the events — they map to the event architecture.
> - If a page has a stage gate: it maps to workflow state — verify in §3 Workflows.

### Widget Injections

> Where custom widgets inject into the platform's existing pages (detail pages, list pages) — when the platform supports injection points.

| Widget | Injects into | Injection spot | Data |
|--------|-------------|---------------|------|
| | | | |

### Key User Flows

> For each persona's primary task, trace the click path from login to completion.

| Persona | Task | Flow (login → done) | Clicks | Notes |
|---------|------|---------------------|--------|-------|
| | | page → page → action → result | | |

### Empty States

> What does a first-time user see? Empty states should guide, not confuse.

| Page/Widget | Empty state message | Action |
|-------------|-------------------|--------|
| | "No X yet. [Create one]" | Link to create page |

#### Checklist
- [ ] Every persona has a defined login-to-primary-task flow `PM`
- [ ] Navigation grouping matches how users think about their work `UX`
- [ ] Dashboard widgets answer "what to do next", not just "data" `UX`
- [ ] Empty states are helpful, not blank pages `UX`
- [ ] Custom pages use the platform's building blocks — custom UI only where flagged `Architect`
- [ ] Click count from login to primary task is ≤ 3 for each persona `UX`
- [ ] If Portal USED: every portal page specced in the table with its building block `PM`
- [ ] If Portal USED: real-time events mapped per page that uses them `Architect`
- [ ] If Portal USED: empty states + stage gates defined `UX`

---

## 4. Workflow Gap Analysis `Architect`

> Gap analysis maps each workflow step to a platform capability.

### Gap Scoring — Atomic Commits

Each gap is measured in **atomic commits** — one self-contained, testable increment that a single focused loop can deliver.

| Score | Meaning | Example |
|-------|---------|---------|
| 0 | Platform does it, zero commits | An existing feature or a permission/role config |
| 1 | 1 commit: config/seed only | Pipeline stages or defaults in seed data |
| 2 | 1–2 commits: small gap | A widget/extension-point addition + i18n |
| 3 | 2–3 commits: medium gap | New entity + CRUD route + admin page |
| 4 | 3–5 commits: large gap | Multi-entity + pages + a workflow definition |
| 5 | 5+ commits or external dependency | External API integration, an LLM pipeline |

### Per-Workflow Gap Matrix

#### WF[N]: [Name] — Total: [N] atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|------|--------------------|-----|-------|---------|-------|
| | | | app / platform / automation / external | | |

> **Scope column:** where does this commit live? `app` = this repo, `platform` = a contribution to the platform itself, `automation` = an external automation/integration layer, `external` = outside both.
> Commits scoped `platform` are upstream contributions — welcome, but they need an upstream PR + approval. Flag them as dependencies: your phase can't ship that commit until upstream merges. Check first whether a sanctioned extension point can cover it from the app side.

[Repeat per workflow]

### Gap Summary

| Workflow | Business Priority | Atomic Commits (raw) | Workaround? | Commits (effective) | Blocks ROI? |
|----------|------------------|---------------------|-------------|---------------------|-------------|
| | | | | | |

The Architect saves detailed commit plans to `<specs-dir>/app-spec-notes/commits-WF<N>.md`.

#### Checklist
- [ ] Every workflow step scored in atomic commits `PM`
- [ ] Architect checkpoint: workflow-to-platform mapping verified — no capability missed, no overengineering, commit plans saved `Architect`

---

## 4.5 Module Architecture `Architect`

> Consolidated view of which platform capabilities this app uses, how it extends them, and what new modules it creates.
> Derived from the per-workflow gap analysis (§4) — the Architect consolidates after checkpoint #1.

### Platform capabilities used

| Capability | Usage | Extension points used | Notes |
|-----------|-------|----------------------|-------|
| | as-is / extend | (as named by the repo's agent docs) | |

### Shared modules (existing or proposed)

> If a gap is reusable (2+ apps would benefit), propose it as a shared/upstream module instead of building it into the app.
> Proposed modules need clear boundaries: single responsibility, no app-specific domain logic.

| Module | Status | Usage | Extension points | Rationale |
|--------|--------|-------|-----------------|-----------|
| | EXISTING / PROPOSED | use / extend / create | | Why shared vs app-level? Would other apps need this? |

### App modules

> App-specific domain logic that is NOT reusable across other apps.

| Module | Responsibility | Entities owned | Notes |
|--------|---------------|----------------|-------|
| | | | |

#### Checklist
- [ ] Every platform capability listed with explicit usage type (as-is / extend) and extension points `Architect`
- [ ] Every listed capability traces to a user story or workflow — template defaults don't count; if §2 rejects the portal, don't list portal capabilities `Architect`
- [ ] Every shared module listed — existing ones with extension points, proposed ones with rationale `Architect`
- [ ] Every gap scored `platform` in §4 has an upstream investigation (specs, issues, PRs — via read-only tracker operations) `Architect`
- [ ] Reusability check: no reusable pattern hidden inside an app module — if 2+ apps would need it, propose it as shared `Architect`
- [ ] Proposed shared modules have a clear boundary — single responsibility, no app-specific domain logic leaked in `Architect`
- [ ] App module count justified — if >2 app modules, explain why they can't be one `Architect`
- [ ] Extension points into shared modules documented — the same sanctioned patterns as for the platform core `Architect`
- [ ] No direct modification of platform or shared-module code — extend only via sanctioned extension points, or FLAG as an upstream PR `PM + Architect`
- [ ] Module boundaries align with bounded-context boundaries — if two modules share invariants or domain events that must be transactionally consistent, they should be one module `DDD`

---

## 5. User Stories `PM`

> Each story traces to a workflow step. Story = an atomic action by one persona with measurable success.

### WF[N]: [Workflow Name]

**US-[N.M]** As [persona], I [action] so that [business outcome].
Success: [concrete, testable criteria]
**Happy path:** [what the user sees/does when it works]
**Alternate paths:** [valid but non-default flows → what happens]
**Failure paths:** [what goes wrong → what the user sees → system state after]

[Repeat per story, grouped by workflow]

### Default User Stories

> When the project seeds demo data (most reference apps do), include these stories so the app is testable
> out of the box without manual setup. They follow the same quality bar as domain stories.

**US-0.1** As someone evaluating this app, I run the project's documented seed/init command and get
pre-configured demo users with distinct roles so that I can log in and test every
persona's experience without manual user/role setup.
Success:
- Each role from §2 Identity Model has at least one seeded user
- All demo users share a single known password logged to the console at seed time
- Login with each demo user shows only the UI and data their role permits
- Seeding is idempotent — running the command twice does not create duplicates
- Demo user emails follow a documented pattern (e.g. `{role}@demo.local`)

**US-0.2** As someone evaluating this app, I start it after seeding
and see realistic demo data (entities across lifecycle states, relationships) so that I can
understand the app's domain without reading source code.
Success:
- At least 2–3 representative entities per major domain concept
- Entities span different lifecycle states (pipeline stages, statuses — whatever the domain has)
- Extended/custom fields populated with realistic values (not "test123"), where the platform supports them
- Demo data is visually distinguishable (names contain a "Demo" marker)

#### Checklist (domain stories)
- [ ] Every story has: persona + action + measurable outcome + success criteria
- [ ] Every story has alternate and failure paths — happy-path-only stories killed
- [ ] Every story traces to a workflow step — no orphan stories
- [ ] Identity checkpoint per story — internal or external? What role key?
- [ ] No weak stories — vague verbs killed: "manage", "track", "handle", "view data"

#### Checklist (default stories)
- [ ] US-0.1: demo users seeded for every role in §2, idempotent, known password
- [ ] US-0.2: demo data covers major domain concepts with realistic values

---

## 6. User Story Gap Analysis `Architect`

> Map each story to a platform capability. Measure in atomic commits.

| Story | Platform Match | Atomic Commits | Notes |
|-------|---------------|----------------|-------|
| | | | |

The Architect saves detailed commit plans to `<specs-dir>/app-spec-notes/commits-US-<N>.md`.

#### Checklist
- [ ] Every story mapped to a specific platform capability/mechanism with an atomic-commit estimate `PM`
- [ ] Architect checkpoint: story-to-platform mapping verified — simplest solution per story, commit plans saved `Architect`

---

## 7. Phasing & Rollout `PM`

> Phasing logic: high business priority + low gap = ship first.
> Every phase must deliver measurable business value. If you can't state the ROI — the phase is artificial. Merge it or cut it.

### Phase [N]: [Name]

**Goal:** [What the user can do after this phase]

**Why this order:** [Business justification]

| Story | What ships | Commits |
|-------|-----------|---------|
| | | |

**Total: [N] atomic commits**
**Workaround:** [if any high-gap blocker is worked around]

**Acceptance criteria:** `DDD writes, PM challenges`

> **Role reversal.** The DDD challenger writes the acceptance criteria — domain invariants that must hold,
> aggregate consistency, event completeness, data integrity. The PM challenges them —
> "is this actually needed for the business to work at this phase?" Over-engineered criteria are cut
> or deferred; criteria essential for domain integrity are accepted. The one who usually critiques
> now defends; the one who builds now pushes back.

**Domain criteria** `DDD`:
- [ ] [Invariant that must hold after this phase — e.g., "every stamped record has exactly one immutable timestamp"]
- [ ] [Aggregate consistency — e.g., "one change proposal per org per period"]
- [ ] [Event completeness — e.g., "TierChanged published on every approval"]
- [ ] [Data integrity — e.g., "an import for the same org+month archives the previous version"]

**Business criteria** `PM`:
- [ ] [Testable action the primary persona can perform end-to-end]
- [ ] [Testable action another persona can perform]
- [ ] ...

**Value delivered:**
- **Business value:** [What business problem is solved that wasn't solved before this phase? Be specific.]
- **ROI metric:** [Measurable outcome. Target number. How you'd know this phase was worth building.]

**Platform ROI** (if a reference app):
- [Platform pattern demonstrated by this phase — e.g., "role-based access with org scoping via the platform's role config"]
- [Platform pattern demonstrated — e.g., "an API interceptor publishing a domain event on entity change"]
- ...
- **Copy test:** [If someone copies this phase's code, what do they learn about building on the platform?]

**PM's challenges to the DDD criteria:** [If the PM pushed back on any domain criterion — what was cut/deferred and why. If all accepted, state "all accepted."]

[Repeat per phase]

### Rollout Summary

```
Phase 1: [name]    [N] commits    [which workflows]
Phase 2: [name]    [N] commits    [which workflows]
...
                   ---------
                   [N] atomic commits total
                   [M] commits for production-ready (Phases 1–N)
```

#### Checklist
- [ ] Phases ordered by: business priority × gap score × blocker status
- [ ] Each phase delivers a complete, usable increment — no half-done workflows
- [ ] Workarounds documented for high-gap blockers (gap >3)
- [ ] Total atomic commits estimated per phase `Architect`
- [ ] Acceptance criteria per phase: DDD wrote domain criteria, PM wrote business criteria `DDD + PM`
- [ ] PM challenged the DDD criteria — over-engineered criteria cut or deferred, essential ones accepted `PM`
- [ ] Business value + ROI metric stated per phase — no artificial phases
- [ ] No artificial phases — every phase delivers measurable business value. If ROI is unclear, merge with an adjacent phase or cut.

---

## 8. Cross-Spec Conflicts `PM`

| Conflict | Specs involved | Resolution |
|----------|---------------|------------|
| | | |

#### Checklist
- [ ] All related specs listed with what each contributes
- [ ] Identity model consistent across specs
- [ ] Terminology consistent — matches the glossary
- [ ] Shared entities owned by one spec — if two specs reference the same entity, one is the owner
- [ ] Every entity in this table exists in §1.3 and is referenced by at least one user story — no phantom entities `PM`
- [ ] Every conflict has a resolution, not "TBD"

---

## 9. Reference App Quality Gate `Architect`

> Only if this project is an example/reference app. N/A otherwise.

**Platform patterns to demonstrate:**
- [list of platform features this app showcases]

**Anti-patterns to avoid:**
- [list of what we're NOT building and why]
- Leaving scaffold boilerplate (example modules, empty directories) from the project generator in the app
- Registering modules the app doesn't use — only register what §4.5 Module Architecture lists, and remove their leftover imports
- Copying or re-implementing platform helpers locally (test helpers, auth utilities, fixture builders) instead of importing them from the platform's shared libraries. If a helper doesn't exist there — contribute it upstream, don't duplicate it in the app. Local copies drift, break on upgrades, and teach the wrong pattern.
- Bypassing the platform's test runner with an app-local test config — the platform's runner handles environments and test discovery consistently

#### Checklist
- [ ] Every piece of new code passes the "copy test" — if someone copies this, do they build ON the platform or AROUND it?
- [ ] Anti-patterns explicitly listed
- [ ] Platform features demonstrated — the app showcases what the platform can do
- [ ] Scaffold boilerplate removed — no example modules, no empty module directories
- [ ] Tests import shared helpers from the platform — no local copies of platform utilities
- [ ] Tests run through the platform's test runner — no app-local test config

---

## 10. Open Questions `PM`

| # | Question | Options | Impact | Owner | Status |
|---|----------|---------|--------|-------|--------|
| | | | | | |

#### Checklist
- [ ] Every question has: options, impact, owner, status
- [ ] No BLOCKER question unresolved before its phase starts
- [ ] Decided questions have their rationale recorded

---

## Production Readiness `PM`

> Assessed per implementation phase. Updated as phases ship.

| Workflow | Deployable | Blocker | What the client would say |
|----------|-----------|---------|---------------------------|
| | | | |

#### Checklist
- [ ] Each workflow assessed: deployable or not — binary, with the specific blocker
- [ ] "What would the client say?" test — the complaint, not the technical gap
- [ ] No workflow stops midway — if it can start but can't complete, it's worse than not existing

---

## Changelog

### [date]
- [what changed and why]
