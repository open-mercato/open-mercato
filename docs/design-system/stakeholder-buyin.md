# N. Stakeholder Buy-in Strategy

> Strategy for convincing stakeholders: personas, arguments, objections, communication plan.

---

### N.1 Elevator Pitch (30 seconds)

#### Variant 1 — For a module maintainer

> Open Mercato has 372 hardcoded colors and 4 different feedback components doing the same thing — meaning every PR with UI changes requires 2-3 review rounds to catch inconsistencies, and dark mode breaks every time someone adds `text-red-600`. The design system gives you 20 semantic tokens and 5 components that eliminate this class of bugs completely. Migrating your module takes 1-2h with a codemod script. In return: less review friction, zero dark mode regressions, and a new contributor to your module becomes productive in an hour instead of two days.

#### Variant 2 — For a new contributor

> Want to add a new screen to Open Mercato? Without a design system you have to browse 5 different modules to guess which colors, spacing, and components to use — and the reviewer will still send back your PR because you used `text-green-600` instead of a semantic token. With the DS you get 3 ready-made page templates (list, create, detail), 5 components that cover 95% of use cases, and lint rules that tell you what to fix BEFORE you submit the PR. First screen in 30 minutes, not 3 hours.

#### Variant 3 — For a project lead / non-technical person

> Open Mercato has 34 modules and each one looks slightly different — 79% of pages don't handle the empty state, status colors differ between modules, dark mode is broken in many places. To the user it looks like 34 different applications glued together. A design system is a set of shared rules and components that makes the entire product look and behave consistently. Investment: 1 hackathon (26h) for the foundation + 2h per module for migration. Return: a consistent product, faster contributor onboarding, accessibility compliance with no extra effort.

### N.2 Before/After Demo Strategy

**When to show: AFTER the hackathon** (Friday evening or Saturday morning).

Rationale: a demo BEFORE the hackathon builds expectations but there is nothing to show — that is a pitch, not a demo. A demo AFTER delivers a concrete artifact: the same screen in two versions. People trust their eyes, not slides.

**What to show — 4 screenshots:**

1. **Before (light mode):** Customers list page with hardcoded `text-red-600` / `bg-green-100` status badges, no empty state, different shades of red in different sections. Clearly visible: the same "active" status in one module is green `bg-green-100`, in another `bg-emerald-50`.

2. **After (light mode):** The same screen with `StatusBadge variant="success"`, `EmptyState` on an empty list, consistent colors from semantic tokens. Visually: everything "breathes" the same, colors complement each other.

3. **Before (dark mode) — KILLER DEMO:** Customers page in dark mode. Hardcoded `text-red-600` on a dark background — text barely visible. `bg-green-100` creates a glaring bright spot. `border-red-200` is nearly invisible. Notice with `bg-red-50` looks like a white rectangle.

4. **After (dark mode):** The same screen with flat semantic tokens. `--status-error-bg: oklch(0.220 0.025 25)` produces a controlled dark red. `--status-success-text: oklch(0.750 0.150 163)` is legible. Contrast verified, not guessed.

**Where to show:** GitHub Discussion with the "Show & Tell" category. Post with 4 side-by-side screenshots. Link to that post in the project README for 2 weeks ("See what's changing"). Discussions allow async comments — no synchronous call required, which is realistic in OSS.

**Dark mode killer demo scenario script:**

> "Let me show you something. This is the list page in customers — dark mode. See that 'Active' badge? `bg-green-100` on a black background. It looks like a bug. Because it IS a bug — 372 times across the codebase. Now the same page after migration. Same badge, but the color comes from a token that has a separate value for dark mode. Zero changes in logic, zero changes in layout — the only difference is where the color comes from. Now multiply that by 34 modules. This is the design system — not new components, not a redesign. It's fixing 372 colors so dark mode just works."

### N.3 "What's In It For You" — per persona

#### 1. Module maintainer (e.g. Sales)

- **Fewer review rounds:** Instead of 2-3 rounds of "change text-red-600 to text-destructive" comments, a lint rule catches it before the PR. You save 20-30 min per review.
- **Dark mode works out of the box:** Semantic tokens switch automatically in dark mode. Zero manual testing, zero bugs like "white text on white background".
- **New contributors to your module become productive faster:** Instead of explaining "how we build pages in Sales", point them to the list page template from section K.1 and say "copy, customize". Onboarding drops from 2 days to 2 hours.

#### 2. New contributor (first PR)

- **Zero guessing:** 3 page templates cover 95% of cases. Copy, rename the entity, add fields. Done.
- **Lint tells you what's wrong BEFORE the reviewer does:** `om-ds/require-empty-state` highlights the problem in your editor. You don't find out about it in a review after waiting 2 days.
- **Fewer decisions:** You don't have to choose between `text-red-500`, `text-red-600`, `text-red-700`, `text-destructive`. There is one answer: the semantic token. Always.

#### 3. Power contributor (10+ PRs, has "their own" patterns)

- **Your patterns become official:** If your module has well-done status badges — show us. The DS formalizes the best patterns from the codebase; it does not invent new ones.
- **Smaller PR diffs:** Consistent base components mean smaller page files — less code to write, less to review, smaller diffs.
- **Influence over component APIs:** The Champions program (section P) gives you a voice in shaping the API. Better to shape the standard than to migrate to it later.

#### 4. End user (Open Mercato customer)

- **The product looks professional:** Consistent colors, typography, and behaviors across modules = trust in the product.
- **Dark mode actually works:** 372 fixed colors mean dark mode is usable, not decorative.
- **Empty states are not dead ends:** 79% of pages without an empty state -> 0%. You always know what to do when there is no data.

#### 5. Project lead

- **Measurable progress:** `ds-health-check.sh` provides a baseline and trend. You know how much work remains and how much has been done.
- **Accessibility without a dedicated audit:** Semantic tokens + enforced aria-labels + contrast-checked palette = WCAG 2.1 AA compliance "for free".
- **Reduced maintenance cost:** 4 feedback components -> 1. 372 hardcoded colors -> 20 tokens. Less code = fewer bugs = less work.


---

## See also

- [Executive Summary](./executive-summary.md) — material for stakeholder presentations
- [Success Metrics Beyond Code](./success-metrics-cx.md) — metrics that convince the business
- [Champions](./champions.md) — DS ambassador strategy
