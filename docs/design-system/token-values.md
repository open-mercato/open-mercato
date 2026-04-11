# I. Concrete Token Values (Draft)

> Wartości OKLCH tokenów semantycznych — light mode, dark mode, status kolory. Checklist kontrastowa.

---

## Kontekst istniejącej palety

Projekt używa OKLCH color space. Kluczowe istniejące wartości referencyjne:

```
Light:  --background: oklch(1 0 0)          /* biały */
        --foreground: oklch(0.145 0 0)       /* prawie czarny */
        --card:       oklch(1 0 0)           /* biały */
        --destructive: oklch(0.577 0.245 27.325) /* czerwony */
        --muted:      oklch(0.97 0 0)        /* jasnoszary */
        --border:     oklch(0.922 0 0)       /* szary border */

Dark:   --background: oklch(0.145 0 0)       /* prawie czarny */
        --foreground: oklch(0.985 0 0)       /* prawie biały */
        --card:       oklch(0.205 0 0)       /* ciemnoszary */
        --destructive: oklch(0.704 0.191 22.216)  /* jasniejszy czerwony */
        --muted:      oklch(0.269 0 0)       /* ciemnoszary */
        --border:     oklch(1 0 0 / 10%)     /* biały 10% */
```

## Zasady projektowania tokenów

1. **Hue angles** zaczerpnięte z istniejących chart colors (spójność palety):
   - Error: ~25° (hue z `--destructive` = 27.325°, `--chart-rose` = 16.439°)
   - Success: ~160° (hue z `--chart-emerald` = 163.225°)
   - Warning: ~80° (hue z `--chart-amber` = 70.08°, `--chart-4` = 84.429°)
   - Info: ~260° (hue z `--chart-blue` = 262.881°)

2. **Lightness ranges:**
   - Light mode bg: L=0.95-0.97 (subtle, prawie biały z odcieniem)
   - Light mode text: L=0.30-0.40 (ciemny, kontrastowy)
   - Light mode border: L=0.80-0.85 (pośredni)
   - Light mode icon: L=0.55-0.65 (nasycony, widoczny)
   - Dark mode bg: L=0.20-0.25 (subtle, ciemny z odcieniem)
   - Dark mode text: L=0.80-0.90 (jasny, kontrastowy)
   - Dark mode border: L=0.35-0.45 (pośredni)
   - Dark mode icon: L=0.65-0.75 (nasycony, widoczny)

3. **Chroma (saturation):**
   - bg: niska (0.01-0.03) — subtlny odcień, nie krzyczy
   - text: średnia (0.06-0.12) — wyraźny kolor, czytelny
   - border: niska-średnia (0.04-0.08)
   - icon: wysoka (0.12-0.20) — wyrazisty, przyciąga wzrok

## Proponowane wartości — Light Mode

```css
:root {
  /* ═══ ERROR (hue ~25°) ═══ */
  --status-error-bg:     oklch(0.965 0.015 25);
  --status-error-text:   oklch(0.365 0.120 25);
  --status-error-border: oklch(0.830 0.060 25);
  --status-error-icon:   oklch(0.577 0.245 27.325); /* = istniejące --destructive */

  /* ═══ SUCCESS (hue ~160°) ═══ */
  --status-success-bg:     oklch(0.965 0.015 160);
  --status-success-text:   oklch(0.350 0.080 160);
  --status-success-border: oklch(0.830 0.050 160);
  --status-success-icon:   oklch(0.596 0.145 163.225); /* ≈ --chart-emerald */

  /* ═══ WARNING (hue ~80°) ═══ */
  --status-warning-bg:     oklch(0.970 0.020 80);
  --status-warning-text:   oklch(0.370 0.090 60);  /* hue shift do 60° — cieplejszy, czytelniejszy */
  --status-warning-border: oklch(0.830 0.070 80);
  --status-warning-icon:   oklch(0.700 0.160 70);

  /* ═══ INFO (hue ~260°) ═══ */
  --status-info-bg:     oklch(0.965 0.015 260);
  --status-info-text:   oklch(0.370 0.100 260);
  --status-info-border: oklch(0.830 0.060 260);
  --status-info-icon:   oklch(0.546 0.245 262.881); /* = --chart-blue */

  /* ═══ NEUTRAL (achromatic) ═══ */
  --status-neutral-bg:     oklch(0.965 0 0);     /* ≈ --muted */
  --status-neutral-text:   oklch(0.445 0 0);
  --status-neutral-border: oklch(0.850 0 0);
  --status-neutral-icon:   oklch(0.556 0 0);     /* = --muted-foreground */
}
```

## Proponowane wartości — Dark Mode

```css
.dark {
  /* ═══ ERROR (hue ~25°) ═══ */
  --status-error-bg:     oklch(0.220 0.025 25);
  --status-error-text:   oklch(0.850 0.090 25);
  --status-error-border: oklch(0.400 0.060 25);
  --status-error-icon:   oklch(0.704 0.191 22.216); /* = istniejące dark --destructive */

  /* ═══ SUCCESS (hue ~160°) ═══ */
  --status-success-bg:     oklch(0.220 0.025 160);
  --status-success-text:   oklch(0.850 0.080 160);
  --status-success-border: oklch(0.400 0.050 160);
  --status-success-icon:   oklch(0.696 0.170 162.480); /* = dark --chart-emerald */

  /* ═══ WARNING (hue ~80°) ═══ */
  --status-warning-bg:     oklch(0.225 0.025 80);
  --status-warning-text:   oklch(0.870 0.080 80);
  --status-warning-border: oklch(0.420 0.060 80);
  --status-warning-icon:   oklch(0.820 0.160 84.429); /* = dark --chart-amber */

  /* ═══ INFO (hue ~260°) ═══ */
  --status-info-bg:     oklch(0.220 0.025 260);
  --status-info-text:   oklch(0.840 0.080 260);
  --status-info-border: oklch(0.400 0.060 260);
  --status-info-icon:   oklch(0.623 0.214 259.815); /* = dark --chart-blue */

  /* ═══ NEUTRAL (achromatic) ═══ */
  --status-neutral-bg:     oklch(0.230 0 0);
  --status-neutral-text:   oklch(0.750 0 0);
  --status-neutral-border: oklch(0.380 0 0);
  --status-neutral-icon:   oklch(0.708 0 0);     /* = dark --muted-foreground */
}
```

## Contrast Ratio — Light Mode

| Para | Text L | Bg L | Estimated CR | WCAG AA (4.5:1) | WCAG AAA (7:1) |
|------|--------|------|-------------|-----------------|----------------|
| error text / error bg | 0.365 / 0.965 | ~7.0:1 | PASS | PASS |
| error text / white bg | 0.365 / 1.000 | ~7.5:1 | PASS | PASS |
| error text / card bg | 0.365 / 1.000 | ~7.5:1 | PASS | PASS |
| success text / success bg | 0.350 / 0.965 | ~7.5:1 | PASS | PASS |
| success text / white bg | 0.350 / 1.000 | ~8.0:1 | PASS | PASS |
| warning text / warning bg | 0.370 / 0.970 | ~6.8:1 | PASS | BORDERLINE |
| warning text / white bg | 0.370 / 1.000 | ~7.2:1 | PASS | PASS |
| info text / info bg | 0.370 / 0.965 | ~6.8:1 | PASS | BORDERLINE |
| info text / white bg | 0.370 / 1.000 | ~7.2:1 | PASS | PASS |
| neutral text / neutral bg | 0.445 / 0.965 | ~4.7:1 | PASS | FAIL |
| neutral text / white bg | 0.445 / 1.000 | ~5.0:1 | PASS | FAIL |

## Contrast Ratio — Dark Mode

| Para | Text L | Bg L | Estimated CR | WCAG AA (4.5:1) | WCAG AAA (7:1) |
|------|--------|------|-------------|-----------------|----------------|
| error text / error bg | 0.850 / 0.220 | ~6.5:1 | PASS | BORDERLINE |
| error text / card bg | 0.850 / 0.205 | ~7.0:1 | PASS | PASS |
| success text / success bg | 0.850 / 0.220 | ~6.5:1 | PASS | BORDERLINE |
| success text / card bg | 0.850 / 0.205 | ~7.0:1 | PASS | PASS |
| warning text / warning bg | 0.870 / 0.225 | ~6.5:1 | PASS | BORDERLINE |
| warning text / card bg | 0.870 / 0.205 | ~7.5:1 | PASS | PASS |
| info text / info bg | 0.840 / 0.220 | ~6.3:1 | PASS | BORDERLINE |
| info text / card bg | 0.840 / 0.205 | ~7.0:1 | PASS | PASS |
| neutral text / neutral bg | 0.750 / 0.230 | ~5.0:1 | PASS | FAIL |
| neutral text / card bg | 0.750 / 0.205 | ~5.5:1 | PASS | FAIL |

> **Uwaga:** Contrast ratio w OKLCH jest szacunkowy (L nie jest liniowe jak w sRGB). Finalne wartości MUSZĄ być zweryfikowane w Chrome DevTools po implementacji. Wszystkie pary text/bg zdają WCAG AA. Dla AAA na kolorowym tle — borderline. Na neutralnym tle (card, background) — wszystkie zdają AAA oprócz neutral.

## Integracja z Tailwind v4

```css
/* globals.css — w sekcji @theme inline */
@theme inline {
  --color-status-error-bg: var(--status-error-bg);
  --color-status-error-text: var(--status-error-text);
  --color-status-error-border: var(--status-error-border);
  --color-status-error-icon: var(--status-error-icon);

  --color-status-success-bg: var(--status-success-bg);
  --color-status-success-text: var(--status-success-text);
  --color-status-success-border: var(--status-success-border);
  --color-status-success-icon: var(--status-success-icon);

  --color-status-warning-bg: var(--status-warning-bg);
  --color-status-warning-text: var(--status-warning-text);
  --color-status-warning-border: var(--status-warning-border);
  --color-status-warning-icon: var(--status-warning-icon);

  --color-status-info-bg: var(--status-info-bg);
  --color-status-info-text: var(--status-info-text);
  --color-status-info-border: var(--status-info-border);
  --color-status-info-icon: var(--status-info-icon);

  --color-status-neutral-bg: var(--status-neutral-bg);
  --color-status-neutral-text: var(--status-neutral-text);
  --color-status-neutral-border: var(--status-neutral-border);
  --color-status-neutral-icon: var(--status-neutral-icon);
}
```

**Użycie w komponentach:**

```tsx
// Zamiast: className="border-red-200 bg-red-50 text-red-800"
// Teraz:   className="border-status-error-border bg-status-error-bg text-status-error-text"

// Zamiast: className="border-emerald-200 bg-emerald-50 text-emerald-900"
// Teraz:   className="border-status-success-border bg-status-success-bg text-status-success-text"
```

## Weryfikacja przed merge — obowiązkowa checklist

- [ ] Wszystkie pary text/bg sprawdzone w Chrome DevTools → Contrast ratio
- [ ] Light mode: screenshot AlertError, AlertSuccess, AlertWarning, AlertInfo, AlertNeutral
- [ ] Dark mode: screenshot AlertError, AlertSuccess, AlertWarning, AlertInfo, AlertNeutral
- [ ] Badge w light mode: StatusBadge all variants
- [ ] Badge w dark mode: StatusBadge all variants
- [ ] Flash message w obu trybach
- [ ] Text on `--background` (page) + `--card` (card) + status bg — 3 konteksty

---

---

## See also

- [Foundations](./foundations.md) — definicje skal i wytyczne
- [Migration Tables](./migration-tables.md) — mapowanie starych wartości na nowe tokeny
- [Enforcement](./enforcement.md) — ESLint rules wymuszające użycie tokenów
