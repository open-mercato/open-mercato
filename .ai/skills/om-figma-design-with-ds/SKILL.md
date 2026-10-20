> **Repo-local override.** Names Open Mercato's committed design-system sources as the design contract, adds the archetype-to-primitive map with reference screens and the house rules for briefs and audits, and routes neighbouring requests to this repo's skills in the base `om-figma-design-with-ds` skill.

## Step 0 — design-tool provider (add)

`.ai/agentic.config.json` sets no `design.provider` and the repo has no `.ai/design-tools/` descriptor yet: work from attached screenshots or exports, or in Prompt mode. Adding a Figma provider descriptor is a separate change; until then no design file is read or written by this skill.

## Modes — routing (add)

DS compliance in code → `om-ds-guardian`; building a designed screen in code → `om-backend-ui-design` (checked by `om-ds-guardian`); a clickable backend prototype from user stories → `om-mockup-prototype`. Ask the disambiguation question in the user's language (this team works in English and Polish).

## Step 2 — load the design system (replace while `.uxproof/` is absent)

When `.uxproof/` exists it is the contract and these files are its source layers. Until `om-ux-setup` has written it, treat these committed sources as the design contract (they are what `om-ux-setup` would extract) and name the missing `.uxproof/` as an evidence limit instead of stopping:

| Contract part | Source in this repo |
|---|---|
| Tokens (code name → `designName`) | `.ai/ds/ds-tokens.json` — canonical snapshot of `apps/mercato/src/app/globals.css` (`yarn ds:tokens`, drift guard `yarn ds:tokens:check`). Each token's `figma.name` is its Figma variable; `figma: null` marks snapshot-only tokens (shadows, font stacks) that Figma models as effect/text styles. |
| Usage rules, restricted contexts, conventions | `.ai/ds-rules.md` (colors, brand colors, typography, spacing, z-index, shadows, icons, breakpoints, focus states, dark mode) |
| Component registry (registry name → `designComponent`) | `.ai/ui-components.md`, `.ai/ui-backend-components.md`, `packages/ui/AGENTS.md` (CrudForm, DataTable, loading/empty/error, flash, portal patterns), Code Connect mappings `packages/ui/figma/*.figma.tsx` |
| Design library | DS Figma file `qCq9z6q1if0mpoRstV5OEA`, variable collection `OM Tokens`, modes `Light` / `Dark` (see `.ai/ds/README.md`) |

- The Figma variables are a one-way mirror of code. A token fix is never a direct edit of `OM Tokens`: it lands in `globals.css`, then `yarn ds:tokens` + `yarn ds:tokens:figma`. Raise it as a design-system gap.
- Figma hex values from the canonical DS table with no own token: header band `#f7f7f7` → `bg-muted`; row/frame borders `#ebebeb` → `border-border` (code ships one border gray; never introduce a second); column labels `#5c5c5c` → `text-muted-foreground`; table radius 8 → `rounded-md`; drawer width 400 → `DrawerContent` default; drawer title 18px → `DrawerTitle` (`text-lg`).
- Component names in briefs are the exact `@open-mercato/ui` exports, so the implementation matches the design 1:1.

## Step 2 — archetype anatomy and reference screens (add)

| Archetype | Anatomy | Reference screens |
|---|---|---|
| List | `Page` + `PageBody`; `PageHeader` (title, count, Create CTA); `DataTable` with toolbar (search `Input` with `<Search>`, `FilterBar`, bulk actions); pagination | `packages/core/src/modules/customers/backend/customers/people/page.tsx`, `…/customers/companies/page.tsx` |
| Detail / Edit | `Page` + `PageBody`; `FormHeader mode="detail"` (title, `StatusBadge`, Actions menu); `CrudForm` (tabs or sections); `FormFooter` Save / Cancel | `packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx` |
| Create | `Page` + `PageBody`; `FormHeader mode="edit"`; `CrudForm`; `FormFooter` | `packages/core/src/modules/customers/backend/customers/people/create/page.tsx` |
| Settings | `SectionPage` with sticky sidebar nav; per-section `DataTable` / `CrudForm` / switches; per-section save | `packages/core/src/modules/auth/backend/sidebar-customization/page.tsx` |
| Dialog | `Dialog` + `DialogContent` (`sm:max-w-md`); `DialogHeader` (`DialogTitle`, `DialogDescription`); `CrudForm` or focused content; `DialogFooter` | `packages/ui/src/backend/sidebar/SidebarCustomizationEditor.tsx` |
| Wizard | step indicator (step N of M); one form group per step; Back / Continue / Finish | `packages/enterprise/src/modules/sso/backend/sso/config/new/page.tsx` (enterprise) |
| Dashboard | greeting / KPI row; grid of injected widgets | `apps/mercato/src/app/(backend)/backend/page.tsx` |
| Empty state | `EmptyState` (icon, title, description, primary CTA, optional `LinkButton`) inside `DataTable emptyState` or full page | consumers of `packages/ui/src/backend/EmptyState.tsx` |
| Error | `ErrorMessage` with a recover action, inside the parent | `LoadingMessage` / `ErrorMessage` from `@open-mercato/ui/backend/detail` |

Required states on every list and detail surface: default, loading (`Spinner` / `DataLoader`), empty (`EmptyState`), error (`ErrorMessage` with retry), success (flash toast or redirect), validation errors (`FormField` error with status-error tokens), hover / focus / active / disabled, and both themes.

## Step 4 — brief and audit house rules (add; audit check 12)

On top of `.ai/ds-rules.md`; a breach is a violation, not a taste call:

- **Icons**: `lucide-react` only, cited by component name in angle brackets (`<Search>`, `<Trash2>`, `<Plus>`); unknown mapping → `[ICON: needs-lucide-mapping — candidates: <A>, <B>]`. Never emoji, inline `<svg>`, or path data. Sizes: `size-4` default, `size-3.5` small icon button, `size-5` toolbar/section icon, `size-12`–`size-16` empty-state hero. Icon-only controls carry an `aria-label`.
- **Color**: semantic tokens only — status as `bg-status-{error|success|warning|info|neutral}-bg` / `-text` / `-border` / `-icon`; never hardcoded `red`/`emerald`/`amber`/`blue` or inline hex. No `dark:` overrides on semantic or status tokens.
- **Restricted tokens**: brand lime / violet and the lime → yellow → violet gradient only in the contexts `.ai/ds-rules.md` → Brand Colors lists (for example `brand-violet` on AI touchpoints and custom-view pills; the gradient on landing heroes, floating feedback / onboarding widgets, and celebration moments; brand CTAs through `FancyButton`); in standard backend UI or as a status color it is a brand-misuse violation. `destructive` only for delete confirmations and error CTAs.
- **Scales**: no arbitrary values (`text-[13px]`, `p-[18px]`, `rounded-[14px]`, `z-[60]`, custom `shadow-[…]`); layering by `z-*` tokens (`z-sticky`, `z-dropdown`, `z-overlay`, `z-modal`, `z-toast`, `z-tooltip`, `z-banner`, `z-top`). Control heights `h-8` / `h-9` / `h-10`; one row never mixes sizes.
- **Primitives**: never raw `<button>`, `<input>`, `<select>`, `<textarea>`; a hand-drawn checkbox, select, or tag is a swap to the `@open-mercato/ui` primitive. A needed primitive that does not exist is a design-system gap put to the user before the brief is finished.
- **Interactions**: every dialog and form — `Cmd/Ctrl+Enter` submits, `Escape` cancels; `focus-visible:shadow-focus`; `aria-required` on required fields; `aria-invalid` plus the status-error ring on failure (Radix `Select` cannot carry native `required` — submit-time validation).
- **Layout**: one-column forms unless the user asks for two (`CrudForm` `column: 1 | 2`); page `p-6`, section `gap-6`/`gap-8`, field `gap-3`, inline `gap-2`; page width up to `max-w-screen-2xl`. Breakpoints per `.ai/ds-rules.md` → Breakpoints (`md` is the first layout breakpoint; the backend sidebar collapses below `lg`).
