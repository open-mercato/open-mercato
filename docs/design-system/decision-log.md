# R. Decision Log

> Registry of DS architectural decisions (DR-001 – DR-010) with context, alternatives, and dates.

---


### R.1 Decision Record Format

```markdown
### DR-NNN: [Decision title]
**Date:** YYYY-MM-DD
**Status:** Accepted | Proposed | Deprecated
**Context:** [1-2 sentences — what problem we're solving]
**Decision:** [1-2 sentences — what we decided]
**Rationale:** [2-3 sentences — why this and not another option]
**Alternatives considered:** [list of rejected options with a 1-sentence reason]
**Consequences:** [what this means in practice]
```

**Where to store: `packages/ui/decisions/` as individual DR-NNN.md files.**

Rationale: Next to the code, versioned in git, reviewed in PRs. Not GitHub Discussions — those get buried in the feed and are not versioned. Not in the main DS document — it grows too quickly. Separate files = easy to link from PR comments ("see DR-001 for why we don't use opacity tokens").

### R.2 Key Decisions

#### DR-001: Flat tokens instead of opacity-based
**Date:** 2026-04-10
**Status:** Accepted
**Context:** We need status color tokens (error/success/warning/info) with separate values for bg, text, border, icon. Options: one base token + opacity modifiers in Tailwind (`bg-status-error/5`) vs separate flat tokens per role.
**Decision:** Flat tokens — a separate CSS custom property per role with the full color value, separate for light and dark mode.
**Rationale:** Opacity-based tokens don't control contrast in dark mode. `oklch(0.577 0.245 27) / 5%` on a white background gives a subtle pink, but on a black background it is invisible. Flat tokens provide full contrast control in both modes. 20 additional custom properties are an acceptable cost for guaranteed accessibility.
**Alternatives considered:** Opacity-based (fewer tokens, but broken dark mode), hybrid (complex, two mental models).
**Consequences:** 20+20 CSS custom properties (light+dark). Naming: `--status-{status}-{role}`. Tailwind mapping via `@theme inline`.

#### DR-002: Geist Sans as the primary font
**Date:** 2026-04-10
**Status:** Accepted
**Context:** The project has been using Geist Sans from the beginning. Alternatives are Inter (popular in SaaS) or a System UI stack (zero web font loading).
**Decision:** Keep Geist Sans. Zero changes.
**Rationale:** Geist is already implemented with font optimization in Next.js. Changing the font means changing the visual identity — that is beyond the scope of DS foundations. Geist has excellent rendering at small sizes, which is critical for dense data UI like ERP.
**Alternatives considered:** Inter (requires migration, minimal visual difference), System UI (inconsistent across OS).
**Consequences:** No additional work. Font loaded via `next/font/local`.

#### DR-003: lucide-react as the only icon library
**Date:** 2026-04-10
**Status:** Accepted
**Context:** The codebase uses lucide-react plus 14 files with inline SVGs (portal, auth, workflows). Available alternatives: Phosphor, Heroicons, mix.
**Decision:** lucide-react as the sole source of icons. Inline SVGs to be migrated.
**Rationale:** lucide-react is already the dominant icon library in the project. It has 1400+ icons, consistent stroke width (2px default), and is tree-shakeable. Adding a second icon library guarantees inconsistency (different stroke widths, sizing conventions). The 14 inline SVGs are a one-time migration.
**Alternatives considered:** Phosphor (6 weight variants — overkill), Heroicons (smaller set, different style), mix (inconsistent).
**Consequences:** New icons come only from lucide-react. Inline SVGs migrated as part of module migration.

#### DR-004: Alert as the unified feedback component
**Date:** 2026-04-10
**Status:** Accepted
**Context:** Two inline feedback components — Notice (3 variants, 7 imports) and Alert (5 variants, 18 imports). Different APIs, different colors.
**Decision:** Alert as primary. Notice deprecated with a bridge period of >=1 minor version.
**Rationale:** Alert has more variants (5 vs 3), more imports (18 vs 7), and uses CVA (easy to extend). Notice only adds a `compact` prop — easy to add to Alert. Unifying 4 different color palettes (section 1.5) for the same semantic purpose requires a single source of truth.
**Alternatives considered:** Notice as primary (fewer variants, less adoption), new component (unnecessary churn), keeping both (perpetuates inconsistency).
**Consequences:** Alert extended with `compact?`, `dismissible?`, `onDismiss?`. Notice gets `@deprecated` JSDoc + runtime `console.warn` in dev mode. 7 Notice imports to migrate.

#### DR-005: FormField as a separate component from CrudForm
**Date:** 2026-04-10
**Status:** Accepted
**Context:** CrudForm (1800 lines) has a built-in FieldControl with label + input + error. Portal and auth pages build forms manually with inconsistent styling. A reusable form field wrapper is needed.
**Decision:** New `FormField` primitive in `packages/ui/src/primitives/form-field.tsx`, independent of CrudForm.
**Rationale:** Refactoring CrudForm to expose FieldControl as a public API requires changes to an 1800-line file used on ~20 pages — the regression risk is too high for a hackathon. A separate FormField is simple, testable, and immediately useful in portal/auth pages. CrudForm can adopt it internally in a future iteration.
**Alternatives considered:** Refactoring CrudForm (high risk, high reward but wrong timing), extract from CrudForm (tight coupling to CrudForm internals).
**Consequences:** FormField: `label?`, `required?`, `labelVariant?`, `description?`, `error?`, `children`. CrudForm continues using its internal FieldControl. Unification in a future iteration.

#### DR-006: OKLCH color space
**Date:** 2026-04-10
**Status:** Accepted
**Context:** The project already uses OKLCH in CSS custom properties (globals.css). Alternatives: HSL (more widely understood), hex (traditional).
**Decision:** Keep OKLCH.
**Rationale:** OKLCH is perceptually uniform — changing lightness by the same amount produces a perceived brightness change of equal magnitude. This is critical for generating consistent status palettes (error, success, warning, info) with controlled contrast. HSL is not perceptually uniform — `hsl(0, 70%, 50%)` and `hsl(120, 70%, 50%)` have different perceived brightness. OKLCH is already implemented — changing it is cost without benefit.
**Alternatives considered:** HSL (wider support, not perceptually uniform), hex (no manipulation possible).
**Consequences:** All new tokens in OKLCH. Checking contrast requires OKLCH-aware tools (Chrome DevTools 120+).

#### DR-007: Tailwind scale + text-overline instead of a custom type scale
**Date:** 2026-04-10
**Status:** Accepted
**Context:** 61 arbitrary text sizes (text-[11px], text-[13px], etc.). Options: a full custom typography scale (heading-1 through caption) vs leveraging Tailwind + a single custom token.
**Decision:** Tailwind scale as primary + one custom token `text-overline` (11px, uppercase, tracking-wider) for the label pattern.
**Rationale:** A full custom scale duplicates what Tailwind already offers (text-xs, text-sm, text-base, text-lg, text-xl, text-2xl). The only missing size is the 11px uppercase label (33 occurrences of text-[11px]) — it gets a dedicated token. The remaining arbitrary sizes (text-[13px], text-[10px]) map to the nearest Tailwind size.
**Alternatives considered:** Full custom scale (maintenance burden, duplicates Tailwind), no custom tokens (loses 11px pattern).
**Consequences:** `--font-size-overline: 0.6875rem`. Codemod maps: `text-[11px]` -> `text-overline`, `text-[13px]` -> `text-sm`, `text-[10px]` -> `text-xs`.

#### DR-008: Per-module migration instead of big-bang
**Date:** 2026-04-10
**Status:** Accepted
**Context:** 372 hardcoded colors across 34 modules. Options: migrate everything at once (big-bang) vs module by module.
**Decision:** Per-module migration. Customers -> Sales -> Catalog -> the rest organically.
**Rationale:** Big-bang creates a massive PR (100+ files) that is impossible to review, easy to break, and blocks all other PRs during merge. Per-module: each PR is 5-15 files, reviewable in 30 minutes, and merging doesn't block others. The codemod script (section J) automates 80% of the work. It also allows validation — if the customers migration reveals a problem with tokens, we fix it BEFORE migrating the remaining 33 modules.
**Alternatives considered:** Big-bang (fast but high risk, unreviewable), file-by-file (too granular, PR spam).
**Consequences:** ~34 migration PRs, 1-2h each. Lint rules `warn` on legacy, `error` on new code. Dashboard (`ds-health-check.sh`) tracks progress.

#### DR-009: warn-then-error lint strategy
**Date:** 2026-04-10
**Status:** Accepted
**Context:** 6 new DS lint rules. Options: error immediately (blocks CI), warn (informs without blocking), warn -> error after migration.
**Decision:** warn on legacy, error on new modules. After a module is migrated -> error globally.
**Rationale:** Immediate error on 372 violations = blocked CI for the entire project. Nobody merges anything until someone fixes legacy. That paralyzes development. warn allows work to continue while educating (contributors see warnings, learn). error on new files prevents new legacy. Gradual ramp-up.
**Alternatives considered:** Immediate error (blocks CI), warn forever (no enforcement), eslint-disable (defeats purpose).
**Consequences:** ESLint config with two blocks — strict for new files, lenient for legacy. After a module is migrated: move files to strict.

#### DR-010: StatusBadge + StatusMap pattern
**Date:** 2026-04-10
**Status:** Accepted
**Context:** Each module defines its own status colors (hardcoded). Options: extend Badge with status variants vs a separate StatusBadge.
**Decision:** Separate StatusBadge (semantic wrapper) that renders Badge internally. Badge gets new CVA variants (success, warning, info).
**Rationale:** StatusBadge and Badge have different API contracts. Badge is a generic visual component (`variant: 'default'|'secondary'|'destructive'|...`). StatusBadge is a semantic component (`variant: 'success'|'warning'|'error'|'info'|'neutral'`) — the contributor thinks "what status?" not "what style?". A separate component enables adding a `dot` indicator, animations, and status-to-variant mapping without cluttering Badge. Internally: `StatusBadge variant="success"` -> `Badge variant="success"`.
**Alternatives considered:** Extend Badge only (mixes semantic and visual concerns), StatusBadge without Badge (duplication).
**Consequences:** `StatusBadge` in `packages/ui/src/primitives/status-badge.tsx`. Badge in `badge.tsx` gets 3 new CVA variants. Zero breaking changes to the existing Badge API.


---

## See also

- [Foundations](./foundations.md) — implementation of decisions DR-001 through DR-005
- [Components](./components.md) — implementation of decisions DR-006 through DR-010
- [Principles](./principles.md) — principles from which these decisions derive
