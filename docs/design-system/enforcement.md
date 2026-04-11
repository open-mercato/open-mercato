# E. Enforcement & Migration Plan

> Plan egzekucji: ESLint rules, codemod scripts, migration playbook dla hardcoded colors, typografii, ikon, komponentów i a11y.

---

## E.1 Hardcoded Colors (372 wystapienia)

### ESLint Rule

Dodac custom rule do `eslint.config.mjs` blokujaca semantic color classes w nowych plikach:

```javascript
// eslint-plugin-open-mercato/no-hardcoded-status-colors.js
// Blokuje: text-red-*, bg-red-*, border-red-*, text-green-*, bg-green-*,
//          text-emerald-*, bg-emerald-*, text-blue-* (status contexts),
//          text-amber-*, bg-amber-*
// Dozwolone: text-destructive, bg-destructive/*, text-status-*, bg-status-*

const BLOCKED_PATTERNS = [
  /\btext-red-\d+/,
  /\bbg-red-\d+/,
  /\bborder-red-\d+/,
  /\btext-green-\d+/,
  /\bbg-green-\d+/,
  /\bborder-green-\d+/,
  /\btext-emerald-\d+/,
  /\bbg-emerald-\d+/,
  /\bborder-emerald-\d+/,
  /\btext-amber-\d+/,
  /\bbg-amber-\d+/,
  /\bborder-amber-\d+/,
  /\btext-blue-\d+/,   // tylko w statusowych kontekstach
  /\bbg-blue-\d+/,
  /\bborder-blue-\d+/,
]
```

**Strategia:** Wlaczyc jako `warn` od dnia 1 (nie blokuje build). Po 2 sprintach przelaczac na `error` dla nowych plikow. Po 4 sprintach — `error` globalnie.

### Codemod / regex strategy

**Faza 1 — Error states (`text-red-600` → semantic token):**

```bash
# Znajdz wszystkie wystapienia
rg 'text-red-600' --type tsx -l
# 107 wystapien — wiekszosc to error messages i required indicators

# Zamiana w CrudForm FieldControl (wewnetrzna):
# text-red-600 → text-destructive
# Dotyczy: required indicator, error message

# Mapowanie:
# text-red-600  → text-destructive
# text-red-700  → text-destructive
# text-red-800  → text-destructive (darker context)
# bg-red-50     → bg-destructive/5
# bg-red-100    → bg-destructive/10
# border-red-200 → border-destructive/20
# border-red-500 → border-destructive/60
```

**Faza 2 — Success states:**

```bash
# Mapowanie:
# text-green-600  → text-status-success
# text-green-800  → text-status-success
# bg-green-100    → bg-status-success-bg
# bg-green-50     → bg-status-success/5
# text-emerald-*  → text-status-success (zamiennie)
# bg-emerald-*    → bg-status-success/*
```

**Faza 3 — Warning/Info states:**

```bash
# Mapowanie:
# text-amber-500  → text-status-warning
# text-amber-800  → text-status-warning
# bg-amber-50     → bg-status-warning/5
# text-blue-600   → text-status-info
# text-blue-800   → text-status-info
# bg-blue-50      → bg-status-info/5
# bg-blue-100     → bg-status-info/10
```

### Strategia migracji: per-modul, nie atomowy PR

**Kolejnosc modulow:**

| # | Modul | Powod | Wysilekek | Pliki |
|---|-------|-------|----------|-------|
| 1 | `packages/ui/src/primitives/` | Fundament — Notice, Alert, Badge | Niski | 4 pliki |
| 2 | `packages/ui/src/backend/` | CrudForm FieldControl, FlashMessages, EmptyState | Sredni | ~10 plikow |
| 3 | `packages/core/src/modules/customers/` | Najbardziej zlozony, referencyjny modul | Sredni | ~15 plikow |
| 4 | `packages/core/src/modules/auth/` | Frontend login z hardcoded alert colors | Niski | 3 pliki |
| 5 | `packages/core/src/modules/sales/` | Status badges na dokumentach | Sredni | ~10 plikow |
| 6 | `packages/core/src/modules/portal/` | Frontend pages z hardcoded colors | Niski | 4 pliki |
| 7 | Pozostale moduly | Katalogowa migracja | Sredni | ~40 plikow |

**Jeden PR per modul.** Kazdy PR:
- Zamienia hardcoded colors na semantic tokens
- Dodaje `// DS-MIGRATED` komentarz w ostatniej linii pliku (do trackingu)
- Testowany wizualnie (screenshot before/after)

---

## E.2 Arbitrary Text Sizes (61 wystapien)

### Tabela mapowania

| Stary | Nowy | Uzasadnienie |
|-------|------|-------------|
| `text-[9px]` | `text-[9px]` (wyjątek) | Notification badge count — zbyt maly na standardową skalę, zachowac |
| `text-[10px]` | `text-xs` (12px) | Zaokraglenie w gore, czytelniejsze |
| `text-[11px]` | `text-xs` (12px) lub nowy `text-overline` | 33 wystapienia — to jest de facto "overline" pattern |
| `text-[12px]` | `text-xs` | Identyczne z text-xs |
| `text-[13px]` | `text-sm` (14px) | Zaokraglenie w gore o 1px |
| `text-[14px]` | `text-sm` | Identyczne z text-sm |
| `text-[15px]` | `text-base` (16px) lub `text-sm` | Zalezy od kontekstu |

**Opcja: dodac `text-overline` do Tailwind config:**

```css
/* globals.css - w sekcji @theme */
--font-size-overline: 0.6875rem; /* 11px */
--font-size-overline--line-height: 1rem;
```

To pozwoli zachowac `text-[11px]` jako `text-overline` bez arbitralnej wartosci.

### Lint rule

```javascript
// Blokuje text-[Npx] w nowych plikach
// Wyjatki: text-[9px] (badge count)
const BLOCKED = /\btext-\[\d+px\]/
const ALLOWED = ['text-[9px]']
```

---

## E.3 Notice → Alert Migration

### Zakres

- **Notice**: 7 plikow
- **Alert**: 18 plikow
- **ErrorNotice**: 2 pliki
- **Razem do migracji**: 9 plikow (Notice + ErrorNotice)

### Strategia: Adapter → Hard Replace

**Krok 1 (hackathon):** Deprecation notice w Notice.tsx

```typescript
// packages/ui/src/primitives/Notice.tsx
/**
 * @deprecated Use <Alert variant="error|warning|info"> instead.
 * Will be removed in v0.6.0.
 * Migration: Notice variant="error" → Alert variant="destructive"
 *            Notice variant="warning" → Alert variant="warning"
 *            Notice variant="info" → Alert variant="info"
 */
export function Notice(props: NoticeProps) {
  if (process.env.NODE_ENV === 'development') {
    console.warn('[DS] Notice is deprecated. Use Alert instead. See migration guide.')
  }
  // ... existing implementation
}
```

**Krok 2 (tydzien po hackathonie):** Migracja 7 plikow Notice → Alert

| Stary (Notice) | Nowy (Alert) |
|-----------------|-------------|
| `<Notice variant="error" title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice variant="warning" title="..." />` | `<Alert variant="warning"><AlertTitle>...</AlertTitle></Alert>` |
| `<Notice variant="info" message="..." />` | `<Alert variant="info"><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice compact message="..." />` | `<Alert variant="info" compact><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice action={<Button>...</Button>} />` | `<Alert variant="info"><AlertDescription>...<AlertAction>...</AlertAction></AlertDescription></Alert>` |
| `<ErrorNotice title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |

**Krok 3 (v0.6.0):** Usuniecie Notice.tsx i ErrorNotice.tsx

### Pliki do migracji (konkretne)

**Notice (7 plikow):**
1. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/signup/page.tsx`
2. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/page.tsx`
3. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/login/page.tsx`
4. `packages/core/src/modules/auth/frontend/login.tsx`
5. `packages/core/src/modules/audit_logs/components/AuditLogsActions.tsx`
6. `packages/core/src/modules/data_sync/backend/data-sync/page.tsx`
7. `packages/core/src/modules/data_sync/components/IntegrationScheduleTab.tsx`

**ErrorNotice (2 pliki):**
8. `packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx`
9. `packages/core/src/modules/entities/backend/entities/user/[entityId]/page.tsx`

---

## E.4 Icon System (inline SVG → lucide-react)

### Zakres: 14 plikow z inline `<svg>`

**Mapowanie custom SVG → lucide equivalent:**

| Plik | Custom SVG | Lucide equivalent |
|------|-----------|-------------------|
| Portal `signup/page.tsx` | CheckIcon, XIcon | `Check`, `X` |
| Portal `dashboard/page.tsx` | BellIcon, WidgetIcon | `Bell`, `LayoutGrid` |
| Portal `page.tsx` | ShoppingBagIcon, UserIcon, ShieldIcon | `ShoppingBag`, `User`, `Shield` |
| `auth/lib/profile-sections.tsx` | Custom icons | Sprawdzic per-icon |
| `workflows/checkout-demo/page.tsx` | CheckIcon, decorative SVG | `Check`, `CircleCheck` |
| `workflows/definitions/[id]/page.tsx` | Flow icons | `Workflow`, `GitBranch` |
| `workflows/EdgeEditDialog.tsx` | Edge icons | `ArrowRight`, `Cable` |
| `workflows/NodeEditDialog.tsx` | Node icons | `Square`, `Circle` |
| `workflows/BusinessRulesSelector.tsx` | Rule icon | `Scale`, `Gavel` |
| `integrations/.../widget.client.tsx` | External ID icon | `ExternalLink`, `Link2` |
| `staff/team-members/page.tsx` | Team icon | `Users`, `UserPlus` |
| `staff/team-roles/page.tsx` | Role icon | `Shield`, `Key` |

**2 pliki testowe** (`__tests__/`) — SVG w mockach, nie wymagaja migracji.

### Strategia

```bash
# Znajdz wszystkie inline SVG (pomijajac testy)
rg '<svg' --type tsx -l --glob '!**/__tests__/**' packages/core/src/modules/
# 12 plikow do migracji (2 testowe pominiete)
```

Migracja per-plik. Kazdy PR zamienia inline SVG na lucide import.

---

## E.5 PR Template Update

Dodac do `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
### Design System Compliance
- [ ] No hardcoded status colors (`text-red-*`, `bg-green-*`, etc.) — use semantic tokens
- [ ] No arbitrary text sizes (`text-[Npx]`) — use typography scale
- [ ] Empty state handled for list/data pages
- [ ] Loading state handled for async pages
- [ ] `aria-label` on all icon-only buttons
- [ ] Uses existing DS components (Button, Alert, Badge) — no custom replacements
```

---

## E.6 AGENTS.md Update

Dodac do root `AGENTS.md` w sekcji `## Conventions` lub jako nowa sekcja `## Design System Rules`:

```markdown
## Design System Rules

### Colors
- NEVER use hardcoded Tailwind colors for status semantics (`text-red-*`, `bg-green-*`, etc.)
- USE semantic tokens: `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`
- Status colors: `destructive` (error), `status-success`, `status-warning`, `status-info`, `status-neutral`

### Typography
- NEVER use arbitrary text sizes (`text-[11px]`, `text-[13px]`)
- USE Tailwind scale: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`
- For 11px overline pattern: use `text-overline` (custom utility)

### Feedback
- USE `Alert` for inline messages (NOT `Notice` — deprecated)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list page MUST handle empty state via `<EmptyState>`
- Every async page MUST show loading via `<LoadingMessage>` or `<Spinner>`

### Icons
- USE `lucide-react` for all icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (xs), `size-4` (sm/default), `size-5` (md), `size-6` (lg)

### Components
- USE `Button`/`IconButton` — NEVER raw `<button>`
- USE `apiCall()`/`apiCallOrThrow()` — NEVER raw `fetch()` in backend pages
- USE `StatusBadge` for entity status display — NEVER hardcoded color Badge
- USE `FormField` wrapper for standalone forms — CrudForm handles internally
- USE `SectionHeader` for collapsible detail sections
```

---

## E.7 Boy Scout Rule

**Policy:** Kazdy PR ktory dotyka pliku z hardcoded status colors MUSI zmigrować przynajmniej dotknięte linie.

**Implementacja:**
- Dodac do PR review checklist
- Dodac komentarz w AGENTS.md:

```markdown
### Boy Scout Rule (Design System)
When modifying a file that contains hardcoded status colors (text-red-*, bg-green-*, etc.),
you MUST migrate at minimum the lines you touched to semantic tokens.
Optionally migrate the entire file if scope allows.
```

- CI check (opcjonalny): skrypt porownujacy `git diff --name-only` z lista plikow zawierajacych hardcoded colors. Jesli PR dotyka pliku z listy ale nie zmniejsza count — warning.

---

---

## See also

- [Metrics](./metrics.md) — KPI i skrypt ds-health-check.sh
- [Migration Tables](./migration-tables.md) — tabele mapowania kolorów i typografii
- [Lint Rules](./lint-rules.md) — reguły ESLint v9 flat config
- [Token Values](./token-values.md) — wartości tokenów OKLCH
