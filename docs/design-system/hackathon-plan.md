# B. Hackathon Plan

> Detailed hackathon plan (FRI 9:00 -- SAT 11:00) with time blocks and deliverables.

---

**Duration:** April 11, 2026 (Friday) 9:00 -- April 12, 2026 (Saturday) 11:00
**Time budget:** ~18h working (26h calendar minus sleep/breaks)
**Strategy:** Foundations first, then components, finally documentation. Each block ends with a commit.

---

## BLOCK 1 — Friday 9:00-12:00 (3h): Foundations + Tokens

**Goal: working semantic color tokens in Tailwind + foundation documentation**

- [ ] Add 20 CSS custom properties to `globals.css` (light mode)
- [ ] Add 20 CSS custom properties to `.dark` (dark mode)
- [ ] Add `text-overline` token (11px)
- [ ] Add `@theme inline` mappings for Tailwind v4
- [ ] Verify contrast in Chrome DevTools (light + dark) — all 5 statuses
- [ ] Document typography scale (table)
- [ ] Document spacing guidelines (usage rules)
- [ ] `yarn lint && yarn typecheck` — make sure nothing is broken
→ **Commit:** `feat(ds): add semantic status tokens, text-overline, and foundation docs`

## BLOCK 2 — Friday 13:00-17:00 (4h): Primitives migration

**Goal: all primitives use semantic tokens**

- [ ] Replace Alert CVA variants with flat semantic tokens (`alert.tsx` — 4 lines)
- [ ] Replace Notice colors with semantic tokens + deprecation warning (`Notice.tsx`)
- [ ] Replace FlashMessages colors (`FlashMessages.tsx`)
- [ ] Replace Notification severity colors
- [ ] Add status variants to Badge (`badge.tsx` — success, warning, info)
- [ ] Migrate CrudForm FieldControl colors (`text-red-600` → `text-destructive`)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate all primitives to semantic status tokens`

## BLOCK 3 — Friday 18:00-20:00 (2h): New components

**Goal: FormField + StatusBadge ready (Section as stretch goal)**

- [ ] Create `FormField` wrapper (`packages/ui/src/primitives/form-field.tsx`)
- [ ] Create `StatusBadge` (`packages/ui/src/primitives/status-badge.tsx`)
- [ ] If time permits: `Section` / `SectionHeader` (`packages/ui/src/backend/Section.tsx`)
- [ ] `yarn lint && yarn typecheck`
→ **Commit:** `feat(ds): add FormField, StatusBadge components`

## Friday 20:00-21:00: BREAK / BUFFER

Rest. If Block 3 ran over — finish it now. Do not start new work.

## BLOCK 4 — Friday 21:00-22:00 (1h): Documentation (light work)

**Goal: principles and checklist ready (low-risk work at end of day)**

- [ ] Write Design Principles — condensed version for README
- [ ] Write PR Review Checklist (DS compliance checkboxes)
- [ ] Define z-index scale + border-radius usage guidelines
→ **Commit:** `docs(ds): add principles, PR review checklist, foundation guidelines`

## BLOCK 5 — Saturday 8:00-10:00 (2h): Customers module migration

**Goal: proof of concept — one module fully migrated (fresh mind)**

- [ ] Run `ds-migrate-colors.sh` on `packages/core/src/modules/customers/`
- [ ] Run `ds-migrate-typography.sh` on the same module
- [ ] Manual review + fix edge cases
- [ ] Screenshot before/after (light + dark)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate customers module to DS tokens`

## BLOCK 6 — Saturday 10:00-11:00 (1h): Wrap-up

**Goal: system ready for adoption**

- [ ] Update AGENTS.md with DS rules
- [ ] Update PR template with DS compliance checkboxes
- [ ] Run `ds-health-check.sh` — record baseline
- [ ] Final `yarn lint && yarn typecheck` pass
→ **Commit:** `docs(ds): update AGENTS.md, PR template, baseline report`

---

**Buffer:** Plan covers ~13h. ~5h of buffer remains for:
- Edge cases in customers migration
- Debugging dark mode contrast
- Section component (if it did not fit in Block 3)
- Surprises in CrudForm FieldControl

---

## B.1 Cut Lines — what if we run out of time

### MUST HAVE — 8h minimum (Blocks 1 + 2)

**Definition of success:** Semantic color tokens exist and are used by existing components. New PRs can use the tokens. Dark mode works.

Commits:
1. `feat(ds): add semantic status tokens, text-overline, and foundation docs`
2. `refactor(ds): migrate all primitives to semantic status tokens`

**What this delivers:**
- 20 semantic tokens in globals.css (light + dark)
- Alert, Notice, Badge, FlashMessages, Notifications — all on tokens
- CrudForm FieldControl — error colors on tokens
- Typography scale and spacing guidelines documented
- Foundation on which everything else is built

**If nothing else gets done** — the hackathon is a success. We have a token system that eliminates 80% of the color problem. Every new PR from now on can use `text-status-error-text` instead of `text-red-600`.

### SHOULD HAVE — 14h (+ Blocks 3, 4)

**Additional commits:**
3. `feat(ds): add FormField, StatusBadge components`
4. `docs(ds): add principles, PR review checklist, foundation guidelines`

**What this adds:**
- New components ready for immediate use
- Principles and PR checklist — enforcement for contributors
- Z-index scale and border-radius guidelines

### NICE TO HAVE — 18h (+ Blocks 5, 6)

**Additional commits:**
5. `refactor(ds): migrate customers module to DS tokens`
6. `docs(ds): update AGENTS.md, PR template, baseline report`

**What this adds:**
- Proof of concept: entire module migrated
- AGENTS.md rules — AI agents generate DS-compliant code
- Baseline health report for tracking progress
- Section component (if it fit in the buffer)

---

## See also

- [Executive Summary](./executive-summary.md) — strategic summary
- [Deliverables](./deliverables.md) — list of expected outputs
- [Enforcement](./enforcement.md) — post-hackathon enforcement plan
