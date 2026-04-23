# Figma Update Checklist — DS Open Mercato

Krok-po-kroku co zmienić w pliku [DS — Open Mercato](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato) żeby odzwierciedlał aktualny stan kodu.

**Podejście**: Kolory w Figmie mapują się 1:1 na kolory w kodzie (oba bazują na Tailwind CSS). Nie tworzymy nowych stylów — używamy istniejącej palety Figma i dokumentujemy mapowanie na tokeny OM.

---

## Etap 1: Kolory — Mapowanie Figma → OM (bez zmian w Figmie!)

Paleta Figma **jest zgodna** z tokenami kodu. Nie trzeba tworzyć nowych Color Styles — wystarczy znać mapowanie.

### 1.1 Neutrals — Figma "Neutral Gray" → OM tokeny

Użyj istniejących kolorów Figma w projektach:

| Figma kolor | OM token w kodzie | Użycie |
|---------------|-------------------|--------|
| **White** / Gray [0] | `--background` | Tło strony |
| **Neutral Gray [50]** | `--primary-foreground` | Tekst na ciemnym tle |
| **Neutral Gray [100]** | `--secondary`, `--muted`, `--accent` | Tła subtle, hover |
| **Neutral Gray [200]** | `--border`, `--input` | Obramowania |
| **Neutral Gray [300]** | `--status-neutral-border` | Obramowanie neutralnych badge/alert |
| **Neutral Gray [400]** | `--ring` | Focus ring |
| **Neutral Gray [500]** | `--muted-foreground`, `--status-neutral-icon` | Placeholder, ikony neutralne |
| **Neutral Gray [600]** | `--status-neutral-text` | Tekst neutralny |
| **Neutral Gray [700-800]** | (nie używane bezpośrednio) | — |
| **Neutral Gray [900]** | ~`--primary` | Przyciski primary (OM: `#2B2B2B`, TW neutral-900: `#171717` — OM jest jaśniejszy) |
| **Neutral Gray [950]** | ~`--foreground` | Główny tekst (OM: `#1A1A1A`, TW neutral-950: `#0A0A0A` — OM jest jaśniejszy) |

### 1.2 Status Colors — Figma → OM status tokeny

| Figma kolor | OM token | Użycie |
|---------------|----------|--------|
| **Red [50]** | `--status-error-bg` | Tło błędu |
| **Red [200]** | `--status-error-border` | Obramowanie błędu |
| **Red [600]** | `--status-error-icon`, `--destructive` | Ikona błędu, przyciski destructive |
| **Red [800]** | `--status-error-text` | Tekst błędu |
| **Green [50]** | `--status-success-bg` | Tło sukcesu |
| **Green [200]** | `--status-success-border` | Obramowanie sukcesu |
| **Green [600]** | `--status-success-icon` | Ikona sukcesu |
| **Green [800]** | `--status-success-text` | Tekst sukcesu |
| **Blue [50]** | `--status-info-bg` | Tło informacji |
| **Blue [200]** | `--status-info-border` | Obramowanie informacji |
| **Blue [600]** | `--status-info-icon` | Ikona informacji |
| **Blue [800]** | `--status-info-text` | Tekst informacji |

**Warning uwaga**: Kod OM używa skali **Amber** (Tailwind), Figma ma **Yellow**. Są różne odcienie:

| Figma Yellow | OM Amber (kod) | Różnica |
|----------------|----------------|---------|
| Yellow [50] = `#FEFCE8` | `--status-warning-bg` = `#FFFBEB` (Amber 50) | Amber cieplejszy |
| Yellow [200] = `#FEF08A` | `--status-warning-border` = `#FDE68A` (Amber 200) | Amber cieplejszy |
| Yellow [600] = `#CA8A04` | `--status-warning-icon` = `#D97706` (Amber 600) | Amber bardziej pomarańczowy |
| Yellow [800] = `#854D0E` | `--status-warning-text` = `#92400E` (Amber 800) | Amber bardziej pomarańczowy |

**Decyzja**: Zostawiamy Amber z kodu (cieplejszy, lepiej wygląda na warning). W Figmie przy warningach używaj **Orange [50/200/600/800]** zamiast Yellow — będzie bliżej naszych wartości.

### 1.3 Chart Colors — Figma → OM chart tokeny

| Figma kolor | OM token |
|---------------|----------|
| **Blue [600]** | `--chart-blue` |
| **Green [600]** | `--chart-emerald` |
| **Orange [500]** | `--chart-amber` |
| **Red [600]** | `--chart-rose` |
| **Purple [600]** | `--chart-violet`, `--brand-violet` |
| **Teal [600]** | `--chart-cyan` |
| **Purple [700]** | `--chart-indigo` |
| **Pink [500]** | `--chart-pink` |
| **Teal [500]** | `--chart-teal` |
| **Orange [600]** | `--chart-orange` |

### 1.4 OM Foundation Colors do dodania

Te nie istnieją w standardowej palecie:

| Nowy styl w Figmie | Hex | Powód |
|--------------------|-----|-------|
| `OM/foreground` | `#1A1A1A` | Nasz foreground jest jaśniejszy niż Gray [950] |
| `OM/primary` | `#2B2B2B` | Nasz primary jest między Gray [800] i [900] |

### 1.5 OM Brand Colors (gradient + neutrals)

**Brand gradient** (używany w `DemoFeedbackWidget`, AI dot, splash screens):

| Styl w Figmie | Hex | Użycie |
|---------------|-----|--------|
| `OM/brand/lime` | `#B4F372` | Start gradient, AI glow |
| `OM/brand/yellow` | `#EEFB63` | Mid gradient |
| `OM/brand/violet` | `#BC9AFF` | End gradient, AI accent |

**Brand neutrals** (osobna skala od semantic tokens — dla hero sections, marketing, branding):

| Styl w Figmie | Hex | Opis |
|---------------|-----|------|
| `OM/brand/white` | `#FFFFFF` | Pure white |
| `OM/brand/gray-100` | `#E7E7E7` | Light gray (subtle backgrounds) |
| `OM/brand/gray-500` | `#B6B6B6` | Medium gray (dividers) |
| `OM/brand/gray-700` | `#434343` | Dark gray (secondary text on light) |
| `OM/brand/black` | `#0C0C0C` | Pure black (hero text) |

### 1.6 Dark Mode Color Styles

DS Open Mercato ma pełny dark mode. Dodaj `OM/dark/*` Color Styles w Figmie (switch między light/dark variants przez Figma Variable Mode lub Color Style naming).

#### Semantic tokens — dark variants

| Token | Light | Dark | Figma style |
|-------|-------|------|-------------|
| background | `#FFFFFF` | `#1A1A1A` | `OM/dark/background` |
| foreground | `#1A1A1A` | `#FAFAFA` | `OM/dark/foreground` |
| card | `#FFFFFF` | `#2B2B2B` | `OM/dark/card` |
| primary | `#2B2B2B` | `#E5E5E5` | `OM/dark/primary` |
| primary-foreground | `#FAFAFA` | `#2B2B2B` | `OM/dark/primary-foreground` |
| secondary / muted / accent | `#F5F5F5` | `#404040` | `OM/dark/muted` |
| muted-foreground | `#737373` | `#A3A3A3` | `OM/dark/muted-foreground` |
| border | `#E5E5E5` | `rgba(255,255,255,0.1)` | `OM/dark/border` |
| input | `#E5E5E5` | `rgba(255,255,255,0.15)` | `OM/dark/input` |
| ring | `#A3A3A3` | `#8A8A8A` | `OM/dark/ring` |
| destructive | `#DC2626` | `#EF4444` | `OM/dark/destructive` |
| brand-violet | `#7C3AED` | `#9F70F3` | `OM/dark/brand-violet` |

#### Status tokens — dark variants

| Status | Role | Light | Dark |
|--------|------|-------|------|
| error | bg / text / border / icon | `#FEF2F2` / `#991B1B` / `#FECACA` / `#DC2626` | `#3B1F1F` / `#FCA5A5` / `#7F1D1D` / `#EF4444` |
| success | bg / text / border / icon | `#F0FDF4` / `#166534` / `#BBF7D0` / `#16A34A` | `#1B2F28` / `#86EFAC` / `#166534` / `#34D399` |
| warning | bg / text / border / icon | `#FFFBEB` / `#92400E` / `#FDE68A` / `#D97706` | `#342B1E` / `#FCD34D` / `#854D0E` / `#F59E0B` |
| info | bg / text / border / icon | `#EFF6FF` / `#1E40AF` / `#BFDBFE` / `#2563EB` | `#1E2640` / `#93C5FD` / `#1E3A8A` / `#3B82F6` |
| neutral | bg / text / border / icon | `#F5F5F5` / `#525252` / `#D4D4D4` / `#737373` | `#3A3A3A` / `#B3B3B3` / `#5E5E5E` / `#A3A3A3` |

#### Jak to wdrożyć w Figmie — 3 opcje

**Opcja A (zalecana): Figma Variables z Modami**

Jeśli używasz Figma Variables (nie starych Color Styles):

1. Variables → Create variable collection → **"OM Colors"**
2. Add modes: **"Light"** i **"Dark"**
3. Dla każdego tokena (`background`, `foreground`, `primary`, status/*) wpisz wartość per-mode
4. Komponenty automatycznie przełączają się między light/dark

**Opcja B: Color Styles z prefiksem**

Stwórz osobne Color Styles:
- `OM/light/background` = `#FFFFFF`
- `OM/dark/background` = `#1A1A1A`
- ... (dla wszystkich tokenów)

Designer podmienia styl manualnie przy dark mode preview.

**Opcja C: Figma Console script**

Uruchom skrypt z sekcji 1.7 poniżej — automatycznie stworzy wszystkie Variables z oboma modami.

### 1.7 Figma Console Script — auto-create wszystkich colors

Zaznacz stronę **Color Palette [Overview]** i uruchom w Figma Plugins → Plugin → Development → Open Console:

```javascript
(async () => {
  // Create variable collection with light/dark modes
  const collection = figma.variables.createVariableCollection("OM Colors");
  const lightMode = collection.modes[0].modeId;
  collection.renameMode(lightMode, "Light");
  const darkMode = collection.addMode("Dark");

  const hexToRgb = (hex) => {
    const v = hex.replace("#", "");
    const r = parseInt(v.substring(0, 2), 16) / 255;
    const g = parseInt(v.substring(2, 4), 16) / 255;
    const b = parseInt(v.substring(4, 6), 16) / 255;
    const a = v.length === 8 ? parseInt(v.substring(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  };

  const createColor = (name, lightHex, darkHex) => {
    const v = figma.variables.createVariable(name, collection, "COLOR");
    v.setValueForMode(lightMode, hexToRgb(lightHex));
    v.setValueForMode(darkMode, hexToRgb(darkHex));
    return v;
  };

  // Foundation
  createColor("background", "#FFFFFF", "#1A1A1A");
  createColor("foreground", "#1A1A1A", "#FAFAFA");
  createColor("card", "#FFFFFF", "#2B2B2B");
  createColor("primary", "#2B2B2B", "#E5E5E5");
  createColor("primary-foreground", "#FAFAFA", "#2B2B2B");
  createColor("muted", "#F5F5F5", "#404040");
  createColor("muted-foreground", "#737373", "#A3A3A3");
  createColor("accent", "#F5F5F5", "#404040");
  createColor("border", "#E5E5E5", "#2A2A2AFF");
  createColor("input", "#E5E5E5", "#303030FF");
  createColor("ring", "#A3A3A3", "#8A8A8A");
  createColor("destructive", "#DC2626", "#EF4444");
  createColor("brand-violet", "#7C3AED", "#9F70F3");

  // Status — Error
  createColor("status/error/bg", "#FEF2F2", "#3B1F1F");
  createColor("status/error/text", "#991B1B", "#FCA5A5");
  createColor("status/error/border", "#FECACA", "#7F1D1D");
  createColor("status/error/icon", "#DC2626", "#EF4444");

  // Status — Success
  createColor("status/success/bg", "#F0FDF4", "#1B2F28");
  createColor("status/success/text", "#166534", "#86EFAC");
  createColor("status/success/border", "#BBF7D0", "#166534");
  createColor("status/success/icon", "#16A34A", "#34D399");

  // Status — Warning
  createColor("status/warning/bg", "#FFFBEB", "#342B1E");
  createColor("status/warning/text", "#92400E", "#FCD34D");
  createColor("status/warning/border", "#FDE68A", "#854D0E");
  createColor("status/warning/icon", "#D97706", "#F59E0B");

  // Status — Info
  createColor("status/info/bg", "#EFF6FF", "#1E2640");
  createColor("status/info/text", "#1E40AF", "#93C5FD");
  createColor("status/info/border", "#BFDBFE", "#1E3A8A");
  createColor("status/info/icon", "#2563EB", "#3B82F6");

  // Status — Neutral
  createColor("status/neutral/bg", "#F5F5F5", "#3A3A3A");
  createColor("status/neutral/text", "#525252", "#B3B3B3");
  createColor("status/neutral/border", "#D4D4D4", "#5E5E5E");
  createColor("status/neutral/icon", "#737373", "#A3A3A3");

  // Brand
  createColor("brand/lime", "#B4F372", "#B4F372");
  createColor("brand/yellow", "#EEFB63", "#EEFB63");
  createColor("brand/violet", "#BC9AFF", "#BC9AFF");
  createColor("brand/white", "#FFFFFF", "#FFFFFF");
  createColor("brand/gray-100", "#E7E7E7", "#E7E7E7");
  createColor("brand/gray-500", "#B6B6B6", "#B6B6B6");
  createColor("brand/gray-700", "#434343", "#434343");
  createColor("brand/black", "#0C0C0C", "#0C0C0C");

  figma.notify(`Utworzono OM Colors z ${collection.modes.length} modami`);
})();
```

**Uwaga brand**: Brand colors nie zmieniają się w dark mode (są to stałe kolory marki — zawsze `#B4F372`, `#BC9AFF` itd., niezależnie od trybu).

**Czas**: ~5 min (skrypt) lub ~30 min (ręcznie przez UI)

---

## Etap 2: Typography — Mapowanie Figma → OM

### 2.1 Font

Figma DS używa **Inter**. Kod OM używa **Geist Sans** (system-ui fallback).

**Decyzja**: Zostaw **Inter** w Figmie. Oba fonty są geometryczne sans-serif, różnice są kosmetyczne i nie wpływają na layout. W przyszłości rozważymy przejście na Inter w kodzie (lub odwrotnie).

### 2.2 Mapowanie Text Styles

Figma DS ma rozbudowaną skalę typografii (H1-H6, Labels, Paragraphs, Subheadings). Kod OM używa prostszych klas Tailwind. Mapowanie:

| Użycie w kodzie | Tailwind class | Figma Text Style |
|----------------|----------------|---------------------|
| Drobne etykiety | `text-xs` (12px/400) | **Label XS** (12px/Medium) — waga różna, rozmiar OK |
| **Domyślny tekst** | `text-sm` (14px/400) | **Paragraph S** lub **Label S** (14px) |
| Etykiety formularzy | `text-sm font-medium` (14px/500) | **Label S** (14px/Medium) |
| Nagłówki Alert/Badge | `text-sm font-semibold` (14px/600) | **Label S** — waga do dostosowania |
| Większy tekst | `text-base` (16px/400) | **Paragraph M** (16px/Regular) |
| Tytuły stron | `text-lg font-semibold` (18px/600) | **H6** (20px/Medium) — rozmiar różny |
| Duże tytuły | `text-xl` (20px/600) | **H5** (24px/Medium) — rozmiar różny |
| Nagłówki główne | `text-2xl` (24px/600) | **H4** (28px/Medium) — rozmiar różny |
| Etykiety sekcji | `text-overline` (11px/500/6% spacing) | **Subheading 2XS** (11px/Medium/6% spacing) — **idealny match!** |

**Wniosek**: Dla tekstu 12-16px — match jest dobry. Dla nagłówków H4-H6 — Figma DS ma większe rozmiary. **Nie zmieniaj** text styles — po prostu używaj ich w Figmie, a w kodzie będą nieco mniejsze. To nie jest kontrowersyjne — nagłówki i tak są do dopasowania per-projekt.

**Jedyny nowy styl do stworzenia:**

Żaden! Figma DS ma pokrycie. Overline = Subheading 2XS (idealny match).

**Czas**: 0 min (nic do tworzenia)

---

## Etap 3: Radius, Shadows, Spacing

### 3.1 Radius

Strona Corner Radius w Figmie (node `553:14961`) ma 13 wartości. DS Open Mercato definiuje **6 tokenów**. Reszta to szum.

#### Co zostało zmienione w kodzie

- `--radius-xl` zmieniony z 14px na **16px** (standard, zamiast dziwnego 14px)
- Wszystkie arbitrary values w checkout (22/24/26/28/30/32px) → `rounded-xl` (16px)
- Wszystkie `rounded-2xl` → `rounded-xl` (konsolidacja, ta sama wartość)

#### Krok 1: Zamień wizualne kwadraty na 6 DS tokens (~5 min)

Istniejące kwadraty (radius-4 do radius-24) zamień na **6 core tokens**:

- **radius-none** = 0px — reset, edge-to-edge
- **radius-sm** = 6px — drobne inline elementy (checkbox, tag chip)
- **radius-md** = 8px — **domyślny** dla interaktywnych (Button, Input, Textarea, Select, Popover)
- **radius-lg** = 10px — kontenery (Alert, Card, Dialog, TabsList, Section)
- **radius-xl** = 16px — duże karty, hero sekcje (checkout, onboarding, feature card)
- **radius-full** = 999px — pill (Badge, Avatar, pill button, toggle)

#### Krok 2: Zaktualizuj tabelę (~10 min)

Zamień istniejącą tabelę 13 wartości na **6 DS tokens + sekcję "Available but not in DS"**:

**DS Tokens:**

| NAME | PIXELS | Kiedy używać |
|------|--------|-------------|
| radius-none | 0px | Reset radius |
| radius-sm | 6px | Małe inline elementy |
| radius-md | 8px | Wszystkie interaktywne elementy (domyślny) |
| radius-lg | 10px | Kontenery, sekcje, dialogi |
| radius-xl | 16px | Duże karty, hero, checkout |
| radius-full | 999px | Pill, okrągłe elementy |

**Dostępne ale poza DS** (zachowaj w Figmie jako referencyję ale oznacz szarym):

| NAME | PIXELS | Status |
|------|--------|--------|
| radius-2 | 2px | Nieużywany |
| radius-4 | 4px | Rzadki (checkboxy) |
| radius-10 | 10px | Pokrywa się z radius-lg |
| radius-12 | 12px | Rzadki |
| radius-20 | 20px | Nieużywany |
| radius-24 | 24px | Nieużywany (skonsolidowany do radius-xl) |
| radius-28 | 28px | Nieużywany (skonsolidowany do radius-xl) |

#### Krok 3: Dodaj sekcję "Usage Guide" (~5 min)

Pod tabelą dodaj wizualny przykład:

```
┌─ radius-md (8px) ─┐  ┌── radius-lg (10px) ──┐  ┌─── radius-xl (16px) ───┐
│    [ Button ]      │  │   Alert / Card       │  │   Hero Card            │
│    [ Input  ]      │  │   Dialog             │  │   Checkout Panel       │
└────────────────────┘  └──────────────────────┘  └────────────────────────┘
```

**Czas**: ~20 min

### 3.2 Borders

Figma DS nie ma osobnej strony Borders — border to property per-component, nie foundational token (jak radius). Kod OM używa prostej skali:

| Tailwind | Px | Kiedy używać |
|----------|-----|-------------|
| `border` | 1px | **Default** — karty, inputy, dividery (1357×) |
| `border-2` | 2px | Active state emphasis (43×) |
| `border-4` | 4px | Left-accent indicators (rare, 11× `border-l-4`) |
| `border-dashed` | — | Placeholders, drop zones, empty states (54×) |
| `border-0` | reset | Reset (38×) |

**Color**: Zawsze semantyczny token — `border-border` (domyślny), `border-input` (inputy), `border-status-{status}-border` (status), `border-destructive` (error).

#### Co zrobić w Figmie (~5 min):

1. **Stwórz Number Variable w kolekcji "Borders"**:
   - `border-default` = 1px
   - `border-emphasis` = 2px
   - `border-accent` = 4px
2. **Opcjonalnie**: dodaj frame "Border Usage" z 3 przykładami (1px card / 2px active tab / 4px left-accent warning)

**Czas**: ~5 min (lub 0 min jeśli pominięte — to drobiazg)

### 3.3 Shadows

Kod OM używa pełną skalę Tailwind v4:

| Tailwind | Figma | Użycie w kodzie |
|----------|-------|-----------------|
| `shadow-xs` | X-Small | Inputy, checkboxy (33×) |
| `shadow-sm` | Small | Karty, panele, sekcje (132×) |
| `shadow-md` | Medium | Hover, elevated cards (68×) |
| `shadow-lg` | Large | Dialogi, overlaye, popovery (34×) |
| `shadow-xl` | X-Large | Floating panels (14×) |
| `shadow-2xl` | 2X-Large | Command palette, modale (19×) |

**Mapowanie 1:1** — nie trzeba nic tworzyć.

**Czas**: 0 min

### 3.4 Motion & Animations

#### Krok 1: Zaktualizuj stronę "Motion & Animations" (~10 min)

Strona Motion już istnieje w Figmie (node `553:14960`). Ma 5 Speed Options. **Dostosuj do faktycznego użycia w kodzie:**

**Zmień tabelę Speed Options** z 5 → 3 pozycje:

| NAME | SPEED | ACTION | TYPE | Zmiana |
|------|-------|--------|------|--------|
| ~~Extra Fast~~ → **Fast** | ~~100ms~~ → **150ms** | While Hovering | Dissolve / Ease Out | Zmień speed na 150ms |
| Fast → **Default** | ~~200ms~~ → **200ms** | While Hovering | Dissolve / Ease Out | Zmień nazwę |
| Normal → **Slow** | **300ms** | While Hovering | Dissolve / Ease Out | Zmień nazwę |
| ~~Slow (400ms)~~ | — | — | — | **Usuń** — kod nie używa |
| ~~Extra Slow (500ms)~~ | — | — | — | **Usuń** — kod nie używa |

#### Krok 2: Dodaj sekcję "Interactions Reference" pod Speed Options (~10 min)

Nowa tabela pod istniejącą:

| Interakcja | Speed | Easing |
|------------|-------|--------|
| Button / Link hover | Fast (150ms) | Ease Out |
| Focus ring | Fast (150ms) | Ease Out |
| Tooltip show | Fast (150ms) | Ease Out |
| Fade in/out | Fast (150ms) | Ease In-Out |
| Dropdown open | Default (200ms) | Ease Out |
| Dropdown close | Default (200ms) | Ease In |
| Accordion expand/collapse | Default (200ms) | Ease In-Out |
| Switch toggle | Fast (150ms) | Ease Out |
| Dialog open | Slow (300ms) | Ease Out |
| Dialog close | Default (200ms) | Ease In |
| Slide-in panel | Slow (300ms) | Ease Out |
| Spinner | 1000ms | Linear ∞ |
| Pulse (loading) | 2000ms | Ease In-Out ∞ |

#### Krok 3: Ustaw prototype transitions na komponentach (~5 min)

Na każdym interaktywnym komponencie (Prototype tab):

| Komponent | Interaction | Duration | Easing |
|-----------|-------------|----------|--------|
| **Button** | Hover → Hover state | 150ms | Ease Out |
| **Input** | Focus → Focus state | 150ms | Ease Out |
| **Dropdown** | Open / Close | 200ms | Ease Out / In |
| **Dialog** | Open / Close | 300ms / 200ms | Ease Out / In |
| **Tooltip** | Show (Dissolve) | 150ms | Ease Out |
| **Accordion** | Expand / Collapse | 200ms | Ease In-Out |
| **Switch** | Toggle | 150ms | Ease Out |

**Czas**: ~25 min (10 min speed options + 10 min interactions reference + 5 min prototype transitions)

### 3.5 Spacing

Kod OM używa Tailwind 4px grid. Analiza usage pokazuje dominujące wartości:

| Tailwind | Px | Użycie | Kontekst |
|----------|-----|--------|----------|
| `gap-2` | 8px | **1102×** | Inline flex (icon+text, przyciski obok siebie) — **default** |
| `px-3 py-2` | 12/8px | **592/573×** | Padding inputów, przycisków |
| `gap-3` | 12px | **429×** | Średni odstęp |
| `space-y-2` | 8px | **410×** | Stackowane elementy |
| `p-4` | 16px | **376×** | Karty, sekcje — **default dla kontenerów** |
| `p-3` | 12px | **265×** | Kompaktowe kontenery |
| `space-y-4` | 16px | **247×** | Sekcje |
| `p-6` | 24px | **105×** | Duże karty, dialogi |

#### 4-stopniowa drabina (zapamiętaj):

| Stopień | Px | Co oddziela |
|---------|-----|-------------|
| **Inline** | 8px | Elementy wewnątrz kontrolki (ikona+label, zawartość przycisku) |
| **Compact** | 16px | Elementy wewnątrz kontenera (pola formularza w karcie, wiersze listy) |
| **Section** | 24px | Sekcje na stronie (sekcje formularza, grupy kart) |
| **Region** | 32px | Główne regiony strony (header vs content, sidebar vs main) |

#### Co zrobić w Figmie (~10 min):

1. **Stwórz Number Variables w kolekcji "Spacing"** (t-shirt sizes, spójne z radius/shadow):
   - `space-xs` = 4px (Tailwind `1`)
   - `space-sm` = 8px (Tailwind `2`) — **Inline**
   - `space-md` = 12px (Tailwind `3`)
   - `space-lg` = 16px (Tailwind `4`) — **Compact**
   - `space-xl` = 24px (Tailwind `6`) — **Section**
   - `space-2xl` = 32px (Tailwind `8`) — **Region**
   - `space-3xl` = 48px (Tailwind `12`)
2. **Dodaj frame "Spacing Ladder"** na stronie DS z 4 wizualnymi krokami (Inline/Compact/Section/Region) z przykładami użycia
3. **Używaj Auto-Layout gap/padding** w komponentach odnosząc się do tych variables, nie arbitrary values

**Czas**: ~10 min

---

## Etap 4: Component — Button

### 4.1 Weź istniejący Button z Figma DS i dostosuj warianty

Figma Button prawdopodobnie ma inne warianty niż kod. Musisz zapewnić że Figma Button ma te **7 wariantów** (property "Variant"):

| Variant | Fill (użyj koloru z Figma) | Text | Border | Hover |
|---------|---------------------------|------|--------|-------|
| **Default** | Gray [900] (≈`--primary`) | Gray [50] | brak | opacity 90% |
| **Destructive** | Red [600] (`--destructive`) | White | brak | opacity 90% |
| **Outline** | White (`--background`) | Gray [950] | Gray [200], 1px | Gray [100] bg |
| **Secondary** | Gray [100] (`--secondary`) | Gray [900] | brak | opacity 80% |
| **Ghost** | transparent | Gray [950] | brak | Gray [100] bg |
| **Muted** | transparent | Gray [500] | brak | Gray [100] bg |
| **Link** | transparent | Gray [900] | brak | underline |

### 4.2 Rozmiary (property "Size")

| Size | Height | Padding H | Font | Radius |
|------|--------|-----------|------|--------|
| **sm** | 32px | 12px | 14px Medium | 8px |
| **default** | 36px | 16px | 14px Medium | 8px |
| **lg** | 40px | 24px | 14px Medium | 8px |
| **icon** | 36x36px | 0 | — | 8px |

### 4.3 Stany

Dla każdego wariantu:
- **Default** — standardowy
- **Hover** — wg tabeli
- **Disabled** — opacity 50%
- **Focus** — ring 3px, Gray [400] at 50% opacity

### 4.4 Detale
- Gap ikona-tekst: **8px** (`gap-2`)
- Icon size: **16x16px**
- Cursor: pointer (default), not-allowed (disabled)

**Jak**: Znajdź Button w Figma Assets → Detach → Dostosuj warianty wg tabeli. Jeśli Figma ma variant "Primary" → zamień na "Default". Jeśli brakuje Ghost/Muted/Link → dodaj.

**Czas**: ~30 min

---

## Etap 5: Component — Badge

### 5.1 Kształt bazowy (użyj Figma Badge, zmień jeśli potrzeba)
- Shape: **Pill** (radius 999px = "Full")
- Padding: **10px H, 2px V**
- Font: **12px SemiBold** (Label XS, zmień na SemiBold)
- Border: **1px**

### 5.2 Warianty — 10 sztuk (użyj kolorów z Figma)

| Variant | Fill | Text | Border |
|---------|------|------|--------|
| **default** | Gray [900] | Gray [50] | transparent |
| **secondary** | Gray [100] | Gray [900] | transparent |
| **destructive** | Red [600] | White | transparent |
| **outline** | transparent | Gray [950] | Gray [200] |
| **muted** | Gray [100] | Gray [500] | transparent |
| **success** | Green [50] | Green [800] | Green [200] |
| **warning** | Orange [50] | Orange [800] | Orange [200] |
| **info** | Blue [50] | Blue [800] | Blue [200] |
| **error** | Red [50] | Red [800] | Red [200] |
| **neutral** | Gray [100] | Gray [600] | Gray [300] |

**Uwaga warning**: Użyj **Orange** z Figma (nie Yellow!) — bliżej naszych wartości Amber.

**Czas**: ~20 min

---

## Etap 6: Component — Alert

### 6.1 Kształt bazowy
- Radius: **10px** (Corner Radius 10)
- Padding: **16px H, 12px V**
- Border: **1px**
- Ikona: 16x16px, left 16px, top 16px (absolute)
- Content padding-left: 32px gdy ikona

### 6.2 Warianty — 5 sztuk

| Variant | Fill | Text | Border | Icon |
|---------|------|------|--------|------|
| **default** | White | Gray [950] | Gray [200] | Gray [950] |
| **destructive** | Red [50] | Red [800] | Red [200] | Red [600] |
| **success** | Green [50] | Green [800] | Green [200] | Green [600] |
| **warning** | Orange [50] | Orange [800] | Orange [200] | Orange [600] |
| **info** | Blue [50] | Blue [800] | Blue [200] | Blue [600] |

### 6.3 Sub-komponenty
- **AlertTitle**: 14px SemiBold, margin-bottom 4px
- **AlertDescription**: 14px Regular, line-height 1.625

**Czas**: ~20 min

---

## Etap 7: Component — Input

### 7.1 Specs (użyj Figma Input, dostosuj)
- Height: **36px**
- Padding: **12px H, 8px V**
- Border: **1px** Gray [200]
- Radius: **8px**
- Font: **14px Regular** (Label S Regular)
- Placeholder: Gray [500]
- Background: transparent

### 7.2 Stany

| Stan | Border | Inne |
|------|--------|------|
| **Default** | Gray [200] | — |
| **Focus** | Gray [400] | ring 3px, Gray [400] at 50% |
| **Disabled** | Gray [200] | opacity 50% |
| **Error** | Red [600] | ring Red [600] at 20% |

### 7.3 Warianty
- Default, With left icon, With right icon, Disabled

**Czas**: ~15 min

---

## Etap 8-16: Pozostałe komponenty (szybkie)

### Etap 8: Checkbox (~5 min)
- Size: **16x16px**, radius **4px**
- Checked: fill Gray [900], checkmark Gray [50]
- Unchecked: border Gray [900]
- Focus: ring 3px Gray [400] at 50%
- Disabled: opacity 50%

### Etap 9: Switch (~5 min)
- Track: **44x24px**, radius 999px
- ON: Gray [900], OFF: Gray [200]
- Thumb: **20px** circle, White
- Disabled: opacity 50%

### Etap 10: Tabs (~10 min)
- TabsList: gap 4px
- TabsTrigger: ghost button sm (32px), 14px Medium
- Active: Gray [100] bg + Gray [900] text
- Inactive: transparent + Gray [950] text

### Etap 11: Card (~10 min)
- Bg: White, Border: 1px Gray [200], Radius: 10px
- CardHeader: padding 24px (top/sides), gap 6px
- CardTitle: 18px SemiBold
- CardDescription: 14px Regular, Gray [500]
- CardContent: padding 24px
- CardFooter: padding 0 24px 24px

### Etap 12: Dialog/Modal (~15 min)
- Overlay: `rgba(0,0,0,0.5)`
- Content: White bg, 1px Gray [200], radius 10px, shadow-lg, padding 24px
- DialogTitle: 18px SemiBold
- DialogDescription: 14px Regular, Gray [500]
- DialogFooter: flex row, justify-end, gap 8px
- Close button: top-right, 16x16px, Gray [500]

### Etap 13: Tooltip (~5 min)
- Bg: Gray [900], Text: Gray [50]
- Font: 12px Regular, Padding: 6px 12px, Radius: 8px

### Etap 14: Separator (~2 min)
- 1px line, Gray [200], horizontal or vertical

### Etap 15: Progress (~5 min)
- Track: 16px height, radius 999px, Gray [100] bg
- Indicator: radius 999px, Gray [900] fill

### Etap 16: Spinner (~5 min)
- Sizes: sm=16px, md=24px, lg=32px
- Color: Gray [500], rotating circle

---

## Etap 17: Komponenty do pominięcia (na razie)

Zbyt złożone na ten etap — wrócisz w Fazie 2:
- **DataTable** — za dużo stanów
- **CrudForm** — specyficzny dla frameworka
- **FilterBar** — złożony
- **NotificationPanel** — dużo sub-komponentów
- **Navigation/Sidebar** — wymaga pełnego layoutu

---

## Etap 18: Stwórz stronę "OM Components"

Nowa strona w Figmie ze wszystkimi komponentami obok siebie:
1. Button — 7 variants x 4 sizes (tabela)
2. Badge — 10 variants (rząd)
3. Alert — 5 variants (stos)
4. Input — 4 stany (rząd)
5. Checkbox, Switch (obok siebie, ON/OFF)
6. Tabs (przykład z 3 tabami)
7. Card z sub-komponentami
8. Dialog (mockup)
9. Tooltip, Separator, Progress, Spinner

To będzie Twoja **referencja** dla deweloperów.

**Czas**: ~15 min

---

## Podsumowanie czasu

| Etap | Co | Czas |
|------|-----|------|
| 1 | Kolory — mapowanie (tylko 2 nowe style!) | **5 min** |
| 2 | Typografia — nic do tworzenia | **0 min** |
| 3 | Radius/Shadows/Spacing/Motion | **42 min** |
| 4 | Button — 7 wariantów × 4 rozmiary | **30 min** |
| 5 | Badge — 10 wariantów | **20 min** |
| 6 | Alert — 5 wariantów | **20 min** |
| 7 | Input — 4 stany | **15 min** |
| 8-16 | Checkbox, Switch, Tabs, Card, Dialog, Tooltip, Separator, Progress, Spinner | **~1h** |
| 18 | Strona referencyjna "OM Components" | **15 min** |
| **Razem** | | **~2.5 godziny** |

vs stare podejście: ~5 godzin. **Oszczędność: 50%** dzięki mapowaniu kolorów zamiast duplikowania.

---

## Zasady mapowania — ściągawka

Gdy projektujesz w Figmie, **używaj kolorów z palety DS** wg tej tabeli:

| Potrzebujesz... | Użyj w Figmie |
|----------------|---------------|
| Tło strony | White |
| Główny tekst | Gray [950] (w kodzie będzie `#1A1A1A`, nie `#0A0A0A`) |
| Przycisk primary | Gray [900] (w kodzie będzie `#2B2B2B`, nie `#171717`) |
| Tekst na przycisku | Gray [50] |
| Tło subtle/hover | Gray [100] |
| Obramowania | Gray [200] |
| Focus ring | Gray [400] |
| Placeholder | Gray [500] |
| Danger/Error | Red [600] |
| Error bg/border/text | Red [50] / Red [200] / Red [800] |
| Success bg/border/text | Green [50] / Green [200] / Green [800] |
| Info bg/border/text | Blue [50] / Blue [200] / Blue [800] |
| Warning bg/border/text | **Orange** [50] / [200] / [800] (NIE Yellow!) |
| Brand accent | Purple [600] |

---

## Po zakończeniu

Gdy Figma będzie gotowa:
1. Ustawimy Figma Code Connect mapping (Figma node IDs → pliki kodu)
2. Zaczniemy dodawać brakujące komponenty w kodzie (Avatar, Breadcrumb, Radio, Select)
3. DS Guardian skill będzie sprawdzał zgodność przy PR review
