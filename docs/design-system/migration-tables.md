# J. Migration Mapping Tables

> Tabele mapowania typografii i kolorów + skrypty codemod (ds-migrate-typography.sh, ds-migrate-colors.sh).

---

## J.1 Typography Mapping

### Tabela zamiany

| Obecne | Zastąp na | Kontekst | Plików | Typ zamiany |
|--------|-----------|----------|--------|-------------|
| `text-[9px]` | `text-[9px]` (ZACHOWAJ) | Notification badge count — 9px jest poniżej minimalnej skali. Jedyne użycie, wyjątek. | 1 | Brak |
| `text-[10px]` | `text-xs` (12px) | Badge small, compact labels. 2px różnicy jest akceptowalna — zyskujemy spójność. | 15 | Regex: `s/text-\[10px\]/text-xs/g` |
| `text-[11px]` | `text-overline` (nowy token, 11px) | Uppercase labels, section headers, captions. To jest de facto "overline" pattern używany w 33 miejscach — zasługuje na własny token. | 33 | 1. Dodaj token do CSS. 2. Regex: `s/text-\[11px\]/text-overline/g` |
| `text-[12px]` | `text-xs` | Identyczne z text-xs (12px). Zamiana 1:1. | 2 | Regex: `s/text-\[12px\]/text-xs/g` |
| `text-[13px]` | `text-sm` (14px) | Small buttons, links. 1px różnicy. Zyskujemy spójność kosztem mikro-zmiany wizualnej. | 7 | Regex: `s/text-\[13px\]/text-sm/g` |
| `text-[14px]` | `text-sm` | Identyczne z text-sm (14px). Zamiana 1:1. | 1 | Regex: `s/text-\[14px\]/text-sm/g` |
| `text-[15px]` | `text-base` (16px) LUB `text-sm` | Portal header subtitle. Kontekstowa decyzja — jeśli to subtitle pod dużym tytułem, `text-base` lepsze. | 2 | Manualna — sprawdzić kontekst |

### Token `text-overline` — definicja

```css
/* globals.css — dodać w @theme inline */
@theme inline {
  --font-size-overline: 0.6875rem;      /* 11px */
  --font-size-overline--line-height: 1rem; /* 16px */
}
```

**Zastosowanie:**
```tsx
// Przed:
<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">

// Po:
<span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
```

### Letter spacing — standaryzacja

Trzy warianty (`tracking-wider`, `tracking-widest`, `tracking-[0.15em]`) używane zamiennie z `text-[11px] uppercase`.

| Obecne | Zastąp na | Uzasadnienie |
|--------|-----------|-------------|
| `tracking-wider` | `tracking-wider` (zachowaj) | Tailwind standard: 0.05em |
| `tracking-widest` | `tracking-wider` | Zbyt szeroki (0.1em). 0.05em wystarczy. |
| `tracking-[0.15em]` | `tracking-wider` | Arbitralny. Standaryzujemy na jedną wartość. |

### Codemod — pełny skrypt

```bash
#!/bin/bash
# ds-migrate-typography.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Uruchamiać per-moduł, potem review diff

set -euo pipefail
MODULE_PATH="$1"  # np. packages/core/src/modules/customers

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-typography.sh <module-path>"
  exit 1
fi

echo "=== Typography migration: $MODULE_PATH ==="

# Portable in-place replace using perl (works identically on macOS and Linux)
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

replace 's/text-\[10px\]/text-xs/g'
echo "  text-[10px] → text-xs: done"

replace 's/text-\[11px\]/text-overline/g'
echo "  text-[11px] → text-overline: done"

replace 's/text-\[12px\]/text-xs/g'
echo "  text-[12px] → text-xs: done"

replace 's/text-\[13px\]/text-sm/g'
echo "  text-[13px] → text-sm: done"

replace 's/text-\[14px\]/text-sm/g'
echo "  text-[14px] → text-sm: done"

replace 's/tracking-widest/tracking-wider/g'
echo "  tracking-widest → tracking-wider: done"

replace 's/tracking-\[0\.15em\]/tracking-wider/g'
echo "  tracking-[0.15em] → tracking-wider: done"

echo "=== MANUAL CHECK NEEDED: text-[15px] (2 instances, contextual decision) ==="
rg 'text-\[15px\]' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

---

## J.2 Color Mapping (Semantic)

### Error colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany | Uwagi |
|--------|-----------|-----------|-------------|-------|
| `text-red-600` | 107 | `text-status-error-text` | Regex 1:1 | Głównie error messages, required indicators |
| `text-red-700` | 19 | `text-status-error-text` | Regex 1:1 | Error text w ciemniejszym kontekście |
| `text-red-800` | 26 | `text-status-error-text` | Regex 1:1 | Error text na jasnym tle (Notice) |
| `text-red-500` | 6 | `text-status-error-icon` | Regex 1:1 | Ikony error |
| `text-red-900` | 1 | `text-status-error-text` | Regex 1:1 | |
| `bg-red-50` | 24 | `bg-status-error-bg` | Regex 1:1 | Error background |
| `bg-red-100` | 14 | `bg-status-error-bg` | Regex 1:1 | Nieco intensywniejsze bg — ten sam token |
| `bg-red-600` | 1 | `bg-destructive` | Manual | Solid error button bg — użyj istniejącego `destructive` |
| `border-red-200` | ~5 | `border-status-error-border` | Regex 1:1 | Error border |
| `border-red-500` | ~5 | `border-status-error-border` | Regex 1:1 | Intensywniejszy error border |
| `text-destructive` | (zachowaj) | — | Nie zmieniaj | Już jest tokenem — prawidłowe użycie |

**Uwaga:** `text-red-600` użyte jako required indicator w CrudForm FieldControl (linia 3418) to wewnętrzna zmiana w `packages/ui/src/backend/CrudForm.tsx`. Jeden PR, duży impact.

### Success colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany |
|--------|-----------|-----------|-------------|
| `text-green-600` | 18 | `text-status-success-text` | Regex 1:1 |
| `text-green-700` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-green-800` | 26 | `text-status-success-text` | Regex 1:1 |
| `text-green-500` | 1 | `text-status-success-icon` | Regex 1:1 |
| `bg-green-100` | 26 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-50` | 4 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-200` | 1 | `bg-status-success-bg` | Manual — sprawdzić intensywność |
| `border-green-*` | ~5 | `border-status-success-border` | Regex 1:1 |
| `text-emerald-600` | 4 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-700` | 6 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-800` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-900` | 3 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-300` | 1 | `text-status-success-icon` | Manual — dark context? |
| `bg-emerald-100` | 2 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-50` | 5 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-500` | 4 | `bg-status-success-icon` | Manual — solid bg? Może `bg-status-success-text` |
| `bg-emerald-600` | 1 | `bg-status-success-icon` | Manual |
| `border-emerald-*` | ~5 | `border-status-success-border` | Regex 1:1 |

### Warning colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany |
|--------|-----------|-----------|-------------|
| `text-amber-500` | ~10 | `text-status-warning-icon` | Regex 1:1 |
| `text-amber-800` | ~5 | `text-status-warning-text` | Regex 1:1 |
| `text-amber-950` | ~2 | `text-status-warning-text` | Regex 1:1 |
| `bg-amber-50` | ~5 | `bg-status-warning-bg` | Regex 1:1 |
| `bg-amber-400/10` | ~2 | `bg-status-warning-bg` | Regex 1:1 |
| `border-amber-200` | ~3 | `border-status-warning-border` | Regex 1:1 |
| `border-amber-500/30` | ~2 | `border-status-warning-border` | Regex 1:1 |

### Info colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany |
|--------|-----------|-----------|-------------|
| `text-blue-600` | 27 | `text-status-info-text` | Regex 1:1 |
| `text-blue-800` | 25 | `text-status-info-text` | Regex 1:1 |
| `text-blue-700` | 8 | `text-status-info-text` | Regex 1:1 |
| `text-blue-900` | 9 | `text-status-info-text` | Regex 1:1 |
| `text-blue-500` | ~5 | `text-status-info-icon` | Regex 1:1 |
| `bg-blue-50` | 24 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-100` | 19 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-600` | 4 | `bg-status-info-icon` | Manual — solid bg for active state? |
| `border-blue-200` | ~3 | `border-status-info-border` | Regex 1:1 |
| `border-blue-500` | ~2 | `border-status-info-border` | Regex 1:1 |
| `border-sky-600/30` | ~2 | `border-status-info-border` | Regex 1:1 |
| `bg-sky-500/10` | ~2 | `bg-status-info-bg` | Regex 1:1 |
| `text-sky-900` | ~2 | `text-status-info-text` | Regex 1:1 |

### Codemod — pełny skrypt

```bash
#!/bin/bash
# ds-migrate-colors.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Uruchamiać per-moduł, potem review diff

set -euo pipefail
MODULE_PATH="$1"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-colors.sh <module-path>"
  exit 1
fi

echo "=== Color migration: $MODULE_PATH ==="

# Portable in-place replace using perl
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

# ═══ ERROR ═══
for shade in 600 700 800 900; do
  replace "s/text-red-$shade/text-status-error-text/g"
done
replace 's/text-red-500/text-status-error-icon/g'
for shade in 50 100; do
  replace "s/bg-red-$shade/bg-status-error-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-red-$shade/border-status-error-border/g"
done

# ═══ SUCCESS (green) ═══
for shade in 500 600 700 800; do
  replace "s/text-green-$shade/text-status-success-text/g"
done
for shade in 50 100 200; do
  replace "s/bg-green-$shade/bg-status-success-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-green-$shade/border-status-success-border/g"
done

# ═══ SUCCESS (emerald) ═══
for shade in 300 600 700 800 900; do
  replace "s/text-emerald-$shade/text-status-success-text/g"
done
for shade in 50 100; do
  replace "s/bg-emerald-$shade/bg-status-success-bg/g"
done
for shade in 200 300; do
  replace "s/border-emerald-$shade/border-status-success-border/g"
done

# ═══ WARNING (amber) ═══
for shade in 500 800 950; do
  replace "s/text-amber-$shade/text-status-warning-text/g"
done
replace "s/bg-amber-50/bg-status-warning-bg/g"
for shade in 200 500; do
  replace "s/border-amber-$shade/border-status-warning-border/g"
done

# ═══ INFO (blue) ═══
for shade in 600 700 800 900; do
  replace "s/text-blue-$shade/text-status-info-text/g"
done
replace 's/text-blue-500/text-status-info-icon/g'
for shade in 50 100; do
  replace "s/bg-blue-$shade/bg-status-info-bg/g"
done
for shade in 200 500; do
  replace "s/border-blue-$shade/border-status-info-border/g"
done

# ═══ INFO (sky — used in Alert component) ═══
replace 's/text-sky-900/text-status-info-text/g'
replace 's/border-sky-600\/30/border-status-info-border/g'
replace 's/bg-sky-500\/10/bg-status-info-bg/g'

echo "=== MANUAL REVIEW NEEDED ==="
echo "  Check: bg-red-600, bg-emerald-500, bg-emerald-600, bg-blue-600"
echo "  These are solid backgrounds — may need different token (icon/emphasis)"
rg 'bg-red-600|bg-emerald-[56]00|bg-blue-600' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

### Zamiana w Alert component (packages/ui/src/primitives/alert.tsx)

**Obecne CVA variants → nowe:**

```typescript
// PRZED:
destructive: 'border-destructive/60 bg-destructive/10 text-destructive [&_svg]:text-destructive',
success:     'border-emerald-600/30 bg-emerald-500/10 text-emerald-900 [&_svg]:text-emerald-600',
warning:     'border-amber-500/30 bg-amber-400/10 text-amber-950 [&_svg]:text-amber-600',
info:        'border-sky-600/30 bg-sky-500/10 text-sky-900 [&_svg]:text-sky-600',

// PO:
destructive: 'border-status-error-border bg-status-error-bg text-status-error-text [&_svg]:text-status-error-icon',
success:     'border-status-success-border bg-status-success-bg text-status-success-text [&_svg]:text-status-success-icon',
warning:     'border-status-warning-border bg-status-warning-bg text-status-warning-text [&_svg]:text-status-warning-icon',
info:        'border-status-info-border bg-status-info-bg text-status-info-text [&_svg]:text-status-info-icon',
```

### Zamiana w Notice component (packages/ui/src/primitives/Notice.tsx)

```typescript
// PRZED:
error:   { border: 'border-red-200',   bg: 'bg-red-50',   text: 'text-red-800',   iconBorder: 'border-red-500' }
warning: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', iconBorder: 'border-amber-500' }
info:    { border: 'border-blue-200',  bg: 'bg-blue-50',  text: 'text-blue-900',  iconBorder: 'border-blue-500' }

// PO (jeśli zachowujemy Notice z deprecation warning):
error:   { border: 'border-status-error-border',   bg: 'bg-status-error-bg',   text: 'text-status-error-text',   iconBorder: 'border-status-error-icon' }
warning: { border: 'border-status-warning-border', bg: 'bg-status-warning-bg', text: 'text-status-warning-text', iconBorder: 'border-status-warning-icon' }
info:    { border: 'border-status-info-border',    bg: 'bg-status-info-bg',    text: 'text-status-info-text',    iconBorder: 'border-status-info-icon' }
```

### Zamiana w FlashMessages (packages/ui/src/backend/FlashMessages.tsx)

```typescript
// PRZED:
const kindColors: Record<FlashKind, string> = {
  success: 'emerald-600',
  error:   'red-600',
  warning: 'amber-500',
  info:    'blue-600',
}

// PO:
const kindColors: Record<FlashKind, string> = {
  success: 'status-success-icon',
  error:   'status-error-icon',
  warning: 'status-warning-icon',
  info:    'status-info-icon',
}
```

### Zamiana w Notifications (packages/ui/src/backend/notifications/)

```typescript
// PRZED:
const severityColors = {
  info:    'text-blue-500',
  warning: 'text-amber-500',
  success: 'text-green-500',
  error:   'text-destructive',
}

// PO:
const severityColors = {
  info:    'text-status-info-icon',
  warning: 'text-status-warning-icon',
  success: 'text-status-success-icon',
  error:   'text-status-error-icon',
}
```

---

## J.3 Component Mapping (Notice → Alert)

### Prop-level mapping

| Notice usage | Alert equivalent | Uwagi |
|-------------|-----------------|-------|
| `<Notice variant="error">` | `<Alert variant="destructive">` | Nazwa zmieniona na "destructive" — spójna z Button |
| `<Notice variant="info">` | `<Alert variant="info">` | Bez zmian |
| `<Notice variant="warning">` | `<Alert variant="warning">` | Bez zmian |
| `title="Tytuł"` | `<AlertTitle>Tytuł</AlertTitle>` | Composition pattern zamiast prop |
| `message="Treść"` | `<AlertDescription>Treść</AlertDescription>` | Composition pattern zamiast prop |
| `action={<Button>Retry</Button>}` | `<AlertAction><Button>Retry</Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Zachowany — mniej paddingu, brak ikony |
| `children` | `children` (wewnątrz Alert) | Zachowane |
| `className="..."` | `className="..."` | Zachowane |

### ErrorNotice mapping

| ErrorNotice usage | Alert equivalent |
|-------------------|-----------------|
| `<ErrorNotice />` (bez props) | `<Alert variant="destructive"><AlertTitle>{t('ui.errors.defaultTitle')}</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" message="Y" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` |
| `<ErrorNotice action={btn} />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...<AlertAction>{btn}</AlertAction></AlertDescription></Alert>` |

### Plik-po-pliku migration plan

| # | Plik | Obecne | Zamień na | Złożoność |
|---|------|--------|-----------|-----------|
| 1 | `portal/signup/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive"><AlertDescription>{...}</AlertDescription></Alert>` | Niska |
| 2 | `portal/page.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Niska |
| 3 | `portal/login/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive">...` | Niska |
| 4 | `auth/frontend/login.tsx` | `<Notice variant="error" ...>` + custom error banners | `<Alert variant="destructive">...` + migracja hardcoded banners | **Średnia** — ma też ręcznie stylowane banery |
| 5 | `audit_logs/AuditLogsActions.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Niska |
| 6 | `data_sync/backend/.../page.tsx` | `<Notice variant="warning" ...>` | `<Alert variant="warning">...` | Niska |
| 7 | `data_sync/.../IntegrationScheduleTab.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Niska |
| 8 | `customers/deals/pipeline/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Niska |
| 9 | `entities/user/[entityId]/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Niska |

**Estimated effort:** 6 plików → 15 min każdy = 1.5h. 2 pliki wymagają więcej uwagi (auth login, data_sync page) = +1h. **Razem: ~2.5h.**

---

## J.4 Kolejność operacji na hackathonie

**Timing:** PT 11.04.2026 9:00 – SO 12.04.2026 11:00 (~13h pracy + ~5h bufor)

Zsynchronizowany z sekcja B. Szczegolowy step-by-step:

```
PIĄTEK 9:00–12:00 (BLOK 1 — Foundations):
  1. Dodaj 20+20 CSS custom properties (flat tokens, light + dark) do globals.css
  2. Dodaj @theme inline mappings (--color-status-*-* → var(--status-*-*))
  3. Dodaj text-overline token (--font-size-overline: 0.6875rem)
  4. Zweryfikuj contrast w Chrome DevTools (light + dark) — 5 statusów × 2 tryby
  5. Udokumentuj typography scale + spacing guidelines
  6. yarn lint && yarn typecheck
  → Commit: "feat(ds): add semantic status tokens and text-overline"

PIĄTEK 13:00–17:00 (BLOK 2 — Migracja primitives):
  7. Zamień Alert CVA variants na flat semantic tokens (alert.tsx — 4 linie)
  8. Zamień Notice colors na flat tokens + dodaj deprecation (Notice.tsx)
  9. Zamień FlashMessages colors (FlashMessages.tsx)
  10. Zamień Notification severity colors
  11. Dodaj Badge status variants: success, warning, info (badge.tsx)
  12. Zmigruj CrudForm FieldControl colors (text-red-600 → text-destructive)
  13. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate all primitives to semantic status tokens"

PIĄTEK 18:00–20:00 (BLOK 3 — Nowe komponenty):
  14. Stwórz FormField (packages/ui/src/primitives/form-field.tsx) z labelVariant
  15. Stwórz StatusBadge (packages/ui/src/primitives/status-badge.tsx) — renderuje Badge
  16. Stretch: Section/SectionHeader (packages/ui/src/backend/Section.tsx)
  17. yarn lint && yarn typecheck
  → Commit: "feat(ds): add FormField, StatusBadge components"

PIĄTEK 20:00–21:00: PRZERWA / BUFOR

PIĄTEK 21:00–22:00 (BLOK 4 — Dokumentacja):
  18. Napisz Design Principles — skrócona wersja do README
  19. Napisz PR Review Checklist
  20. Zdefiniuj z-index scale + border-radius guidelines
  → Commit: "docs(ds): add principles, PR review checklist, guidelines"

SOBOTA 8:00–10:00 (BLOK 5 — Migracja customers):
  21. Uruchom ds-migrate-colors.sh na packages/core/src/modules/customers/
  22. Uruchom ds-migrate-typography.sh na tym samym module
  23. Manual review + fix edge cases + screenshots before/after
  24. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate customers module to DS tokens"

SOBOTA 10:00–11:00 (BLOK 6 — Wrap-up):
  25. Zaktualizuj AGENTS.md z DS rules
  26. Zaktualizuj PR template z DS compliance checkboxami
  27. Uruchom ds-health-check.sh — zapisz baseline do .ai/reports/
  28. Final yarn lint && yarn typecheck
  → Commit: "docs(ds): update AGENTS.md, PR template, baseline report"
```

**Bufor:** ~5h na edge case'y, Section component (jeśli nie zmieścił się w B3), dark mode fine-tuning.
**Cut lines:** Patrz sekcja B.1 — MUST HAVE to Bloki 1+2 (8h).

---

## See also

- [Token Values](./token-values.md) — docelowe wartości tokenów
- [Enforcement](./enforcement.md) — plan egzekucji migracji
- [Foundations](./foundations.md) — skale typografii i kolorów
- [Risk Analysis](./risk-analysis.md) — ryzyka związane z migracją
