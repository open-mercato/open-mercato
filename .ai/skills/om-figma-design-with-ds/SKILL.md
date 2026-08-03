---
name: om-figma-design-with-ds
description: "Two-mode skill for Figma + Open Mercato Design System. MODE A — Generate design briefs for NEW screens that conform to the shipped DS (tokens, primitives, layout patterns). MODE B — Audit EXISTING Figma designs against the DS and produce a remediation plan (violations + fixes + optional Figma variable swap commands). Activates on: 'design w figmie', 'figma mockup', 'create figma design', 'mockup screen', 'zaprojektuj w figmie', 'figma prototype', 'new screen design', 'design brief', 'mockup for', 'figma design system', 'design with DS' (MODE A) — and: 'audit figma', 'review figma design', 'dostosuj design do DS', 'sprawdź design', 'figma DS audit', 'make this design DS-compliant', 'migrate figma to DS', 'figma conformance check', 'designs nie zgodne z DS' (MODE B). Output is a copy-pastable prompt for any Figma-capable agent (Claude with Figma plugin, ChatGPT, Cursor, or the figma-use MCP tools)."
---

# Figma Design with Open Mercato DS

You are the bridge between a product idea and a Figma mockup that uses the **exact** tokens, primitives, and layout patterns we ship in `@open-mercato/ui`. The user says "design X" — you produce a Figma-ready brief listing every component, token, and state to use, so the resulting mockup can be implemented in code without any DS drift.

## When this skill activates

Two modes — pick based on what the user is asking for:

### MODE A — Generate a brief for a NEW screen
Activate when the user is starting from scratch: list page, detail, settings, dashboard, wizard, dialog, empty state.
Triggers: "design w figmie", "figma mockup", "zaprojektuj w figmie", "create figma design", "mockup screen", "new screen design".

### MODE B — Audit an EXISTING design and produce a remediation plan
Activate when the user has a Figma file / frame / screenshot / link and wants it brought into DS conformance.
Triggers: "audit figma", "review figma design", "dostosuj design do DS", "sprawdź design", "figma DS audit", "make this design DS-compliant", "migrate figma to DS", "figma conformance check", "designs nie zgodne z DS", "mam designy ale chcę żeby były zgodne z DS".

### How to disambiguate

If unclear from the user's first message, ask one short question:
- Polish: "Tworzymy nowy design od zera (MODE A) czy audytujemy istniejący żeby był zgodny z DS (MODE B)?"
- English: "Are we designing a new screen from scratch (MODE A) or auditing an existing design for DS conformance (MODE B)?"

### MODE B fast path

If MODE B and the user just wants the prompt to paste into another Claude/Figma session:
- **Do NOT generate the audit yourself.** Just hand them the ready-to-paste prompt template.
- Open `references/audit-existing-design-prompt.md`, copy the block under "## Copy from here ↓", and output it verbatim with the `<FIGMA_URL>` and `<CONTEXT>` placeholders intact for them to fill.
- Add one line: "Replace `<FIGMA_URL>` with your Figma link (or attach a screenshot) and `<CONTEXT>` with a one-sentence description of what the screen does, then send it to Claude with Figma plugin / Cursor / ChatGPT."

If MODE B and the user has already provided the Figma link/screenshot AND wants the audit done now in this session:
- **Run the audit yourself** following the format in `references/audit-existing-design-prompt.md`.
- Produce all four output sections (Summary, Violations, Remediation plan, Optional Figma operations) without modification.

Do NOT activate this skill for:
- Reviewing existing CODE → use `ds-guardian`
- Implementing a Figma file as code → use `figma:figma-implement-design`
- Pushing existing app code into Figma → use `figma:figma-generate-design`
- Generic "make it look better" with no DS context → use `ui-designer`

## Workflow

### Step 1 — Gather brief (always ask if not supplied)

Required from user:
1. **Screen archetype**: list | detail/edit | settings | dashboard | wizard | dialog | empty-state | error
2. **Domain**: what entity / module (e.g. customers, orders, exchange rates, sidebar variants)
3. **Primary user**: admin | tenant owner | employee | customer (portal)
4. **Goal in one sentence**: what the user wants to accomplish on this screen
5. **Key data fields / actions**: what fields appear, what buttons exist, what the primary action is
6. **Must-have states**: loading, empty, error, success, validation errors

If any of these are missing, ASK in a single concise message before producing the brief — don't guess.

### Step 2 — Pick the layout pattern

Match the archetype to one of these shipped patterns (full templates in `references/layout-patterns.md`):

| Archetype | Wrapper | Header | Body | Footer |
|---|---|---|---|---|
| List | `<Page><PageBody>` | `<PageHeader>` with title + count + "Create" CTA | `<DataTable>` with toolbar (search, filters, bulk actions) | pagination |
| Detail / Edit | `<Page><PageBody>` | `<FormHeader mode="detail">` with title + status badge + Actions dropdown | `<CrudForm>` with tabs or sections | `<FormFooter>` with Save / Cancel |
| Create | `<Page><PageBody>` | `<FormHeader mode="edit">` (compact) | `<CrudForm>` | `<FormFooter>` |
| Settings | `<SectionPage>` with sticky sidebar nav | section title in inner panel | mixed: `<DataTable>` lists, `<CrudForm>` sub-forms, switches | per-section save |
| Dashboard | `<Page><PageBody>` | greeting / KPIs row | grid of injected widgets | — |
| Wizard | `<Dialog>` or full-page steps | step indicator (1 of N) | one form group per step | Back / Continue / Finish |
| Dialog | `<Dialog>` portal | `<DialogHeader>` with title + description | `<CrudForm>` or focused content | `<DialogFooter>` Cmd+Enter primary, Escape cancel |
| Empty state | inside `<DataTable emptyState>` or full-page | — | `<EmptyState>` with icon + title + description + primary CTA | — |
| Error | inside parent | — | `<ErrorMessage>` with recover-action button | — |

### Step 3 — Load current DS state

Always reference these files at brief generation time so the output reflects today's tokens, not yesterday's:

- `@.ai/ds-rules.md` — full token tables, decision trees, naming rules
- `@.ai/ui-components.md` — primitives catalog with variants, sizes, props, MUST rules
- `@packages/ui/AGENTS.md` — workflow patterns (CrudForm, DataTable, Loading/Empty/Error, Flash, Notifications, Portal)
- `@references/quick-tokens.md` — compressed cheat sheet for the prompt itself

### Step 4 — Generate the Figma brief

Output a single markdown block with this structure (the user pastes this verbatim into Figma AI / Claude with Figma plugin / Cursor):

```markdown
# Figma Design Brief — <screen name>

## Goal
<one-sentence brief>

## User
<persona + their context>

## Layout
- Wrapper: <Page>/<PageBody> | <SectionPage> | <Dialog> | full-page
- Max width: <max-w-screen-2xl 1536px | sm:max-w-md | …>
- Spacing: outer p-6, section gap-6, field gap-3, inline gap-2

## Sections (in order)
1. <Section name> — <purpose, components used>
2. …

## Components — use these exact primitives from @open-mercato/ui
- <Component> (<variant/size>) — <what it renders, where>
- e.g. Button (default size=default) — primary CTA "Save changes"
- e.g. Input (size=default leftIcon=<Search>) — search box in toolbar
- e.g. Tag (variant=success dot) — "Active" status indicator
- e.g. StatusBadge (variant=warning dot) — "Pending review"

## Tokens — use ONLY these CSS variables
### Colors
- Foreground: text-foreground, text-muted-foreground
- Background: bg-background, bg-muted (for hover), bg-popover (for dropdowns)
- Border: border-border, border-input (form borders)
- Status: bg-status-{success|error|warning|info|neutral}-bg + text-status-{...}-text + border-status-{...}-border + text-status-{...}-icon
- Brand (marketing CTAs only): var(--brand-lime), var(--brand-violet), gradient from #B4F372 → #EEFB63 → #BC9AFF (135deg)
- Destructive: text-destructive, bg-destructive (only for delete confirmations / red buttons)

### Typography
- Display: text-2xl (24px) page titles
- Section heading: text-lg (18px) or text-xl (20px)
- Body: text-base (16px) primary content, text-sm (14px) form labels & data tables
- Hint / help: text-xs (12px) descriptions, hints
- Overline: text-overline (11px uppercase) section labels above headings
- NEVER use arbitrary text sizes (no text-[13px], text-[15px])

### Spacing (4px grid; no arbitrary values)
- Page padding: p-6 (24px)
- Card / section padding: p-4 or p-6
- Form field gap: gap-3 (12px)
- Inline (button + icon): gap-2 (8px)
- Stack between major sections: gap-6 (24px) or gap-8 (32px)

### Radius
- Inputs / buttons / cards: rounded-md (8px)
- Pills / tags / avatars: rounded-full
- Modal: rounded-xl (16px)
- NEVER arbitrary px values (no rounded-[14px])

### Z-index (use tokens, not numeric)
- z-base, z-sticky, z-dropdown, z-overlay, z-modal, z-toast, z-tooltip, z-banner, z-top
- NEVER z-[60], z-[9999] etc.

### Shadows
- shadow-xs (form fields), shadow-sm (cards), shadow-md (popovers), shadow-xl (floating CTAs / hover lift)

## Icons — ABSOLUTE rules (zero exceptions)
- Library: lucide-react ONLY. NEVER inline `<svg>`, NEVER `d="M..."` SVG path data, NEVER Unicode emoji as icons (✏️ 🗑️ 📦 ⚠️ ✅ ❌ 🚀 ✨ 🔥 🎉 💡 🔍 ⏰ 📊 ⭐ 🏷️ 🔧 ➕ ✓ ✗ — and any other emoji or pictographic character).
- Always cite the lucide-react component name in angle brackets: `<Search>`, `<Trash2>`, `<Plus>`, `<ArrowRight>`, `<AlertTriangle>`, `<CheckCircle2>`, `<Pencil>`, `<X>`, `<ChevronDown>`, `<ListFilter>`. Reference: https://lucide.dev/icons/
- If you cannot find a matching lucide component, write `[ICON: needs-lucide-mapping — candidates: <Foo>, <Bar>]` with 2–3 candidates. Do NOT default to emoji.
- Default size: size-4 (16px)
- Toolbar / icon buttons: size-4
- Empty state hero icon: size-12 to size-16
- Prose status indicators: write the literal words "PASS" / "FAIL" / "TODO" — never ✓ / ✗ / 🟢 / 🔴.

## States to design
- [ ] Default
- [ ] Loading (Spinner inside DataLoader / page skeleton)
- [ ] Empty (EmptyState with icon + title + description + primary CTA)
- [ ] Error (ErrorMessage with retry action)
- [ ] Success after submit (flash toast + cleared form OR redirect)
- [ ] Validation errors (FormField with error prop, status-error tokens)
- [ ] Hover / focus / active / disabled for interactive elements
- [ ] Dark mode (all tokens have dark-mode values — no `dark:` overrides needed)

## Interactions
- Cmd/Ctrl+Enter: primary action (every dialog & form)
- Escape: cancel / close (every dialog)
- Tab / Shift+Tab: focus traversal (use focus-visible:shadow-focus)
- aria-required, aria-invalid on form fields
- aria-label on icon-only buttons

## Responsive
- Mobile (< sm): single-column form, full-width DataTable with horizontal scroll, dialog occupies safe-area
- Tablet (sm ≥ 640px): 2-column form layout via CrudForm `column: 1 | 2`
- Desktop (lg ≥ 1024px): full DataTable visibility, sticky sidebar, max-w-screen-2xl page

## Out of scope (don't design)
- <list anything explicitly excluded>

## Reference screens in shipped app
<paste 2-3 file paths from packages/core/src/modules/**/backend/** that follow the same archetype>
```

### Step 5 — Optional: push to Figma directly

If the user has the Figma MCP plugin connected (`figma:figma-use` tools available), offer:

> Want me to push this brief into Figma directly via `figma:figma-generate-design`? It'll create a starter frame with the layout + DS tokens already wired up. (yes/no)

If yes → invoke the figma-use skill (NOT this one — that's a separate skill). Pass the brief above as the design source.

## Output rules

- The brief MUST be **self-contained** — a designer who has never seen this codebase should be able to produce a faithful mockup from it
- Cite **exact token names** (no "warm green", no hex without a CSS var fallback)
- Cite **exact primitive imports** so the implementation matches the design 1:1
- Include **3 reference screens** from shipped code in `Reference screens` section so the designer can study existing patterns
- Default to "less is more" — if a primitive doesn't exist for what's needed, FLAG it and ask whether to add one BEFORE producing the brief
- Default to one-column forms unless the user explicitly asks for two

## Reference screens by archetype (paste into the brief)

| Archetype | Open these files first |
|---|---|
| List | `packages/core/src/modules/customers/backend/customers/people/page.tsx`, `…/companies/page.tsx` |
| Detail | `packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx` |
| Create | `packages/core/src/modules/customers/backend/customers/people/create/page.tsx` |
| Settings (sectioned) | `packages/core/src/modules/auth/backend/sidebar-customization/page.tsx` |
| Dialog (form) | `packages/ui/src/backend/sidebar/SidebarCustomizationEditor.tsx` (Add new variant dialog) |
| Wizard | `packages/onboarding/src/modules/onboarding/backend/wizard/page.tsx` |
| Empty state | `packages/ui/src/backend/EmptyState.tsx` consumers |
| Dashboard | `apps/mercato/src/app/(backend)/backend/page.tsx` (DashboardScreen) |

## Common mistakes to prevent

When generating the brief, watch for and pre-empt these recurring issues:

1. **Hardcoded status colors** — never write `text-red-500`, `bg-emerald-50` in the brief. Always `text-status-error-text`, `bg-status-success-bg`.
2. **Arbitrary text/size** — never `text-[13px]`, `p-[18px]`. Use the scale.
3. **dark: overrides on tokens** — DS tokens already handle dark mode. The brief should say "no dark: prefix on status/foreground tokens".
4. **Raw HTML** — `<button>`, `<input>`, `<textarea>`, `<select>` are forbidden in the brief. Always reference primitives.
5. **Missing states** — every brief MUST list loading + empty + error states explicitly. If a screen "doesn't have an empty state," that's a discovery — surface it.
6. **Z-index numbers** — never `z-[60]`, always `z-banner` / `z-modal` / `z-tooltip`.
7. **Arbitrary radius** — never `rounded-[14px]`, always `rounded-md`/`rounded-xl`/`rounded-full`.
8. **Missing keyboard shortcuts** — every dialog requires `Cmd/Ctrl+Enter` + `Escape`. Mention them in the brief.
9. **Inline SVG / emoji icons** — ZERO emoji (✏️ 🗑️ 📦 ⚠️ ✅ ❌ 🚀 ✨ etc.), ZERO `<svg>` markup, ZERO `d="M..."` path data. Always specify lucide-react component name in angle brackets: `<Search>`, `<ListFilter>`, `<Trash2>`, `<Plus>`, `<Pencil>`, `<X>`, `<ArrowRight>`, `<AlertTriangle>`, `<CheckCircle2>`, `<ChevronDown>`. If the brief references unknown icons, write `[ICON: needs-lucide-mapping — candidates: <Foo>, <Bar>]` instead of guessing with emoji. Self-check: scan output before sending and replace any pictographic Unicode with a `<ComponentName>` or with literal words ("PASS", "FAIL", "TODO", "warning").

## Examples

### Example 1: list page brief

User: "design a Figma mockup for /backend/sales/orders list page"

You ask (if not provided): primary user, must-have filters, primary CTA, key columns, empty/error states.

You produce: a brief that specifies `<Page><PageBody>` wrapper, `<PageHeader>` with title "Orders" + count badge + "Create order" Button, `<DataTable tableId="sales.orders">` with columns (number, customer, total, status, created), `<FilterBar>` with Status (Select), Date range (DatePicker), Customer (LookupSelect), and search Input with leftIcon=Search; row actions menu (View, Duplicate, Cancel); status column uses `<StatusBadge variant={statusMap[order.status]} dot>`. Loading state via DataLoader; empty state with `<ShoppingBag>` icon + "No orders yet" + "Create first order" button; error via `<ErrorMessage>`.

### Example 2: settings dialog

User: "design a 'Edit user role' dialog"

Brief: `<Dialog>` with `<DialogContent className="sm:max-w-md">`, header with `<DialogTitle>` "Edit role" + `<DialogDescription>`. Body: `<CrudForm>` with name (Input), description (Textarea), default landing page (Select with options), permissions (CheckboxField list grouped by feature module). Footer: cancel (Button variant="ghost"), Save (Button) — Cmd/Ctrl+Enter submits, Escape cancels.

### Example 3: empty state

User: "design empty state for /backend/integrations when no integrations connected"

Brief: `<EmptyState>` inside `<PageBody>`. Icon: `<Plug>` size-12 in muted-foreground. Title: text-xl "No integrations connected yet". Description: text-base text-muted-foreground "Connect your first integration to start syncing data from external systems." Primary action: Button asChild → `<Link href="/backend/integrations/marketplace">Browse marketplace</Link>` with rightIcon=`<ArrowRight>`. Secondary: LinkButton "Read the integration guide" → docs URL. Background: bg-background. Dark mode: tokens handle it.
