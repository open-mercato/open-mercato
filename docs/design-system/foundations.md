# Część 3 — Foundations

> Tokeny, skale i wytyczne fundacyjne: kolory, typografia, spacing, z-index, border-radius, breakpoints, ikony.

---

## 3.1 Color System

### Co obejmuje
Pelny system kolorow obejmujacy: palette, semantic tokens, status colors, surface colors, interactive colors, chart colors.

### Po co jest potrzebny
Eliminuje 372 hardcoded kolorow. Umozliwia dark mode. Centralizuje decyzje kolorystyczne.

### Decyzje do podjecia
- Czy zachowac OKLCH? (TAK — juz wdrozone, nowoczesne, dobre)
- Ile status colors? (4: error, success, warning, info)
- Czy dodac "neutral" status? (np. draft, archived)
- Jak mapowac na Tailwind utilities?

### Decyzja architekturalna: Flat tokens, NIE opacity-based

**Uzywamy flat tokens** — oddzielny CSS custom property per rola (bg, text, border, icon) z pelna wartoscia koloru. Kazdy token ma oddzielna wartosc dla light i dark mode.

```
TAK:  --status-error-bg: oklch(0.965 0.015 25);     /* pelna wartosc, kontrolowany kontrast */
      .dark { --status-error-bg: oklch(0.220 0.025 25); }

NIE:  --status-error: oklch(0.577 0.245 27);         /* jeden bazowy kolor */
      bg-status-error/5                                /* opacity w Tailwind */
```

**Dlaczego:** Opacity-based tokens (`bg-status-error/5`) nie kontroluja kontrastu w dark mode. `oklch(0.577 0.245 27) / 5%` na bialym tle daje subtlny rozowy, ale na czarnym tle jest prawie niewidoczny. Flat tokens daja pelna kontrole nad kontrastem w obu trybach.

**Konwencja naming:**
- CSS variable: `--status-{status}-{role}` np. `--status-error-bg`
- Tailwind class: `{property}-status-{status}-{role}` np. `bg-status-error-bg`, `text-status-error-text`
- Tailwind mapping: `--color-status-{status}-{role}: var(--status-{status}-{role})`

### Stan obecny
Dobre: `--primary`, `--secondary`, `--destructive`, `--muted`, `--accent`, `--card`, `--popover`, `--border`, chart colors.
Brak: semantic status tokens, surface hierarchy, interactive state tokens.

### Tokeny do zdefiniowania

```
// Primitive palette (juz istnieje w OKLCH)
color.primary.DEFAULT / foreground
color.secondary.DEFAULT / foreground
color.destructive.DEFAULT / foreground
color.muted.DEFAULT / foreground
color.accent.DEFAULT / foreground

// Semantic status (BRAKUJE — krytyczne)
color.status.error.bg / text / border / icon
color.status.success.bg / text / border / icon
color.status.warning.bg / text / border / icon
color.status.info.bg / text / border / icon
color.status.neutral.bg / text / border / icon

// Surface hierarchy (czesciowo istnieje)
color.surface.page          // --background
color.surface.card          // --card
color.surface.popover       // --popover
color.surface.sidebar       // --sidebar
color.surface.overlay       // bg-black/50

// Interactive (czesciowo w CVA)
color.interactive.focus      // --ring
color.interactive.hover      // computed
color.interactive.disabled   // opacity-50

// Border
color.border.default         // --border
color.border.input           // --input
color.border.focus           // --ring
```

### Bledy bez tej warstwy
- 372 hardcoded kolorow — kazdy contributor "zgaduje" jaki kolor uzyc
- Dark mode broken dla semantic colors
- Zmiana palette wymaga grep+replace w calym codebase

### MVP: **TAK** — semantic status tokens (eliminuje 80% problemu)
### Pozniej: palette refinement, surface hierarchy documentation

---

## 3.2 Typography

### Co obejmuje
Font family, size scale, weight scale, line height, letter spacing, text style tokens.

### Po co jest potrzebny
Eliminuje 61 arbitralnych rozmiarow tekstu. Daje jasna hierarchie wizualna.

### Decyzje do podjecia
- Ile poziomow heading? (4-6)
- Ile rozmiarow body? (2-3: default, small, large)
- Jakie specjalne style? (caption, label, overline, code)
- Czy zachowac Geist Sans/Mono? (TAK — juz wdrozone)

### Tokeny do zdefiniowania

```
// Font family (istnieje)
font.sans           // Geist Sans
font.mono           // Geist Mono

// Size scale (mapowanie na Tailwind)
text.display        // text-4xl (36px) — hero, landing
text.heading.1      // text-2xl (24px) — page titles
text.heading.2      // text-xl (20px) — section titles
text.heading.3      // text-lg (18px) — subsections
text.heading.4      // text-base font-semibold (16px) — card titles
text.body.default   // text-sm (14px) — primary body
text.body.large     // text-base (16px) — emphasized body
text.caption        // text-xs (12px) — secondary info
text.label          // text-xs font-medium uppercase tracking-wider — form labels, overlines
text.overline       // text-[11px] font-semibold uppercase tracking-wider — section labels (alias for existing pattern)
text.code           // text-sm font-mono — code blocks

// Weight
font.weight.regular    // 400
font.weight.medium     // 500
font.weight.semibold   // 600
font.weight.bold       // 700

// Line height
leading.tight       // 1.25 — headings
leading.normal      // 1.5 — body
leading.relaxed     // 1.75 — long text

// Letter spacing
tracking.tight      // -0.01em — headings
tracking.normal     // 0 — body
tracking.wide       // 0.05em — labels, overlines
```

### Bledy bez tej warstwy
- `text-[11px]` vs `text-xs` vs `text-[12px]` — 3 sposoby na "maly tekst"
- 3 rozne warianty letter-spacing dla uppercase labels
- Brak hierarchii = kazdy contributor wybiera rozmiar "na oko"

### MVP: **TAK** — size scale + text style tokens
### Pozniej: line height fine-tuning, responsive typography

---

## 3.3 Spacing Scale

### Co obejmuje
Siatka spacing, gap/padding/margin scale, breakpoints.

### Po co jest potrzebny
Standaryzuje odstepy. Eliminuje "dlaczego tu gap-3 a tam gap-4?".

### Decyzje do podjecia
- Jaka baza? (4px = wersja Tailwind default)
- Ktore wartosci sa "oficjalne"?
- Jak dokumentowac "ktory spacing kiedy"?

### Tokeny do zdefiniowania

```
// Spacing scale (Tailwind defaults, ale z naming)
space.0      // 0px
space.0.5    // 2px — micro spacing (icon-to-text)
space.1      // 4px — tight spacing (between related elements)
space.1.5    // 6px — between form label and input
space.2      // 8px — default gap between related items
space.3      // 12px — gap between form fields
space.4      // 16px — gap between sections
space.6      // 24px — page section spacing
space.8      // 32px — major section breaks

// Semantic spacing (aliases)
space.inline.xs     // space.1 — tight inline gap
space.inline.sm     // space.2 — default inline gap
space.inline.md     // space.3 — comfortable inline gap
space.stack.xs      // space.1 — tight vertical gap
space.stack.sm      // space.2 — default vertical gap
space.stack.md      // space.3 — form field gap
space.stack.lg      // space.4 — section gap
space.stack.xl      // space.6 — page section gap
space.inset.sm      // space.2 — compact padding
space.inset.md      // space.3 — default padding
space.inset.lg      // space.4 — comfortable padding
space.inset.xl      // space.6 — spacious padding

// Page layout
space.page.gutter    // space.6 (Page component: space-y-6)
space.page.body      // space.4 (PageBody component: space-y-4)
space.page.section   // space.4
```

### Usage guidelines
- `gap-2` (8px): default gap miedzy powiazanymi elementami (buttons, badges, inline items)
- `gap-3` (12px): gap miedzy polami formularza
- `gap-4` (16px): gap miedzy sekcjami na stronie
- `gap-6` (24px): gap miedzy glownymi sekcjami strony
- **NIE uzywac** `gap-5`, `gap-7` — te wartosci nie sa w oficjalnej skali

### MVP: **TAK** — usage guidelines document + lint rules
### Pozniej: Semantic spacing tokens jako CSS variables

---

## 3.4 Border Radius

### Co obejmuje
Radiusy zaokraglenia dla roznych kontekstow.

### Tokeny do zdefiniowania

```
// Juz istnieja w globals.css:
radius.sm      // 0.25rem — small inputs, tags
radius.md      // 0.375rem — buttons, inputs, badges
radius.lg      // 0.625rem — cards, alerts, containers
radius.xl      // 1.025rem — modals, portal cards
radius.full    // 9999px — avatars, pills, circular buttons
radius.none    // 0 — tables, embedded elements
```

### Usage guidelines
- `rounded-sm`: tagi, male tokeny
- `rounded-md`: buttony, inputy, badge, drobiazgi
- `rounded-lg`: karty, alerty, kontener
- `rounded-xl`: modale, portal karty, duze kontenery
- `rounded-full`: avatary, pille, status dots
- `rounded-none`: tabele, elementy wtopione w kontener

### MVP: **TAK** — documentation only (tokeny juz istnieja)
### Pozniej: enforcement via lint

---

## 3.5 Borders

### Co obejmuje
Grubosc, styl, kolory obramowania.

### Tokeny do zdefiniowania

```
border.width.default    // 1px
border.width.thick      // 2px — focus ring, active tab
border.color.default    // --border
border.color.input      // --input
border.color.focus      // --ring
border.color.error      // color.status.error.border
border.color.success    // color.status.success.border
border.style.default    // solid
border.style.dashed     // dashed — empty states, drop zones
```

### MVP: **TAK** — w ramach color tokens
### Pozniej: oddzielne tokeny

---

## 3.6 Elevation / Shadows

### Co obejmuje
System cieni i warstw dla depth perception.

### Tokeny do zdefiniowania

```
shadow.none         // brak — flat elements
shadow.sm           // subtle — cards at rest
shadow.md           // moderate — dropdowns, popovers
shadow.lg           // strong — modals, overlays
shadow.inner        // inset — pressed states, inputs
```

### Z-index scale

```
z.base          // 0 — page content
z.sticky        // 10 — sticky headers, progress bar
z.dropdown      // 20 — dropdown menus, popovers
z.overlay       // 30 — mobile sidebar overlay
z.modal         // 40 — dialog/modal
z.toast         // 50 — flash messages, toasts
z.tooltip       // 60 — tooltips (always on top)
```

### MVP: **TAK** — z-index scale (zapobiega konfliktom)
### Pozniej: shadow tokens

---

## 3.7 Iconography

### Co obejmuje
Icon library, sizing, stroke width, usage patterns.

### Stan obecny
- **Oficjalna biblioteka:** `lucide-react` (v0.556.0) w root package.json
- **Problem:** Portal i niektorze moduly uzywaja custom inline SVG z roznymi stroke widths (1.5 vs 2) i sizing (size-4 vs size-5)

### Decyzje do podjecia
- Standardize na lucide-react everywhere
- Jeden stroke width (2px — lucide default)
- Jeden sizing system

### Tokeny do zdefiniowania

```
icon.size.xs      // size-3 (12px) — inline, badge icons
icon.size.sm      // size-4 (16px) — default icon size
icon.size.md      // size-5 (20px) — prominent icons
icon.size.lg      // size-6 (24px) — hero icons, empty states
icon.size.xl      // size-8 (32px) — feature icons
icon.stroke       // 2 (lucide default)
```

### MVP: **TAK** — standardize na lucide-react, usunac inline SVG
### Pozniej: custom icon set jesli potrzebny

---

## 3.8 Motion / Animation

### Co obejmuje
Timing, easing, transition patterns.

### Stan obecny
- AI-specific animations w globals.css (pulse, glow, sparkle)
- Flash message: `slide-in` 300ms ease-out
- Dialog: Radix animations (fade-in/out, slide-in/out)
- Brak zdefiniowanej skali timing

### Tokeny do zdefiniowania

```
motion.duration.instant    // 0ms — immediate state change
motion.duration.fast       // 100ms — micro interactions (hover, focus)
motion.duration.normal     // 200ms — standard transitions
motion.duration.slow       // 300ms — complex animations (modals, drawers)
motion.duration.slower     // 500ms — page transitions

motion.easing.default      // ease-out
motion.easing.spring       // cubic-bezier(0.34, 1.56, 0.64, 1) — bouncy
motion.easing.smooth       // ease-in-out
```

### MVP: **NIE** — obecne animacje sa wystarczajace
### Pozniej: standardize duration/easing tokens

---

## 3.9 Interaction States

### Co obejmuje
Hover, focus, active, disabled, selected, loading states.

### Tokeny do zdefiniowania

```
state.hover.opacity        // used for bg-opacity changes
state.disabled.opacity     // 0.5
state.focus.ring.width     // 3px
state.focus.ring.color     // --ring
state.focus.ring.offset    // 0
state.selected.bg          // bg-accent
state.loading.opacity      // 0.7
```

### MVP: **NIE** — CVA juz obsluguje stany w buttonach
### Pozniej: centralize w tokenach

---

## 3.10 Accessibility Foundations

### Co obejmuje
Focus management, color contrast, screen reader support, reduced motion, touch targets.

### Decyzje do podjecia
- WCAG level: AA (minimum) czy AAA?
- Minimum touch target: 44x44px
- Focus visible strategy
- Reduced motion support

### Tokeny / reguły

```
a11y.focus.visible          // focus-visible:ring-[3px] focus-visible:ring-ring/50
a11y.touch.target.min       // 44px
a11y.contrast.min           // 4.5:1 (AA for normal text)
a11y.contrast.large.min     // 3:1 (AA for large text)
a11y.motion.reduced         // prefers-reduced-motion: reduce
```

### MVP: **TAK** — wymagany aria-label na IconButton (TypeScript), skip-to-content link
### Pozniej: automated contrast checking, WCAG AAA

---

## 3.11 Content Foundations

### Co obejmuje
Tone of voice, microcopy patterns, error message guidelines.

### Decyzje do podjecia
- Formalny vs nieformalny ton?
- Techniczny vs user-friendly error messages?
- Max dlugosc button labels?
- Wzorce empty state copy?

### Guidelines

```
// Error messages
"Could not save changes. Please try again."      // DOBRZE
"Error 500: Internal Server Error"                // ZLE

// Empty states
"No customers yet"                                // Title
"Create your first customer to get started."      // Description
"Add customer"                                    // Action

// Button labels
"Save"                                            // DOBRZE (krotki, jasny)
"Click here to save your changes"                 // ZLE (za dlugi)
"Submit"                                          // OK (generyczny)
"Save customer"                                   // LEPIEJ (kontekstowy)

// Confirmation dialogs
"Delete this customer?"                           // Title
"This action cannot be undone."                   // Description
"Delete" / "Cancel"                               // Actions
```

### MVP: **NIE** — to jest praca contentowa
### Pozniej: content style guide

---

## Foundations — kolejnosc wdrazania

```
1. Color System (semantic status tokens)     <- eliminuje 372 hardcoded kolorow
   |
2. Typography Scale                          <- eliminuje 61 arbitralnych rozmiarow
   |
3. Spacing Scale (documentation)             <- standaryzuje 793+ spacing decisions
   |
4. Border Radius (documentation)             <- tokeny juz istnieja, trzeba udokumentowac
   |
5. Iconography (lucide-react standard)       <- eliminuje custom inline SVG
   |
6. Z-index / Elevation                       <- zapobiega layering conflicts
   |
7. Accessibility Foundations                 <- TypeScript enforcement
   |
8. Motion                                    <- mozna odlozyc
   |
9. Content Foundations                       <- mozna odlozyc
```

**Zaleznosci:**
- Typography zalezy od spacing (line height)
- Border/Elevation zalezy od Color System
- Iconography jest niezalezna
- Accessibility jest cross-cutting — dotyczy wszystkich

**Hackathon MVP:**
1. Semantic color tokens (CSS variables + Tailwind mapping)
2. Typography scale (Tailwind config + documentation)
3. Spacing guidelines (documentation)
4. Z-index scale (CSS variables)
5. Border radius guidelines (documentation)

---

## See also

- [Foundations Gaps — Motion, Type, Icons](./foundations-gaps.md) — uzupełnienie: animacje, hierarchia typografii, ikony
- [Token Values](./token-values.md) — konkretne wartości OKLCH
- [Audit](./audit.md) — dane audytu z których wynikają foundations
- [Migration Tables](./migration-tables.md) — tabele migracji kolorów i typografii
