# Anatomia ekranów backendu — ściąga dla prototypów

Struktury wyprowadzone z realnych komponentów (`packages/ui/src/backend/`, moduł `customers`).
Kopiuj stąd zamiast zgadywać — prototyp, który różni się układem od produkcji, wprowadza
recenzentów w błąd i generuje uwagi do rzeczy, które i tak wyglądają inaczej.

Odpowiedniki tych struktur w czystym CSS są już w `components.css` / `screens.css` szablonu.
Ta ściąga tłumaczy **dlaczego** tak, i co łatwo pomylić.

---

## Powłoka aplikacji — `AppShell.tsx`

```
grid lg:grid-cols-[240px_1fr]   (collapsed: [80px_1fr])
├── aside   border-r py-4 px-3
└── div     flex min-h-svh flex-col
    ├── header  61px sticky border-b bg-background/95 backdrop-blur px-3 sm:px-4 lg:px-6 py-3
    ├── main    flex-1 p-4 lg:p-6 mx-auto w-full max-w-screen-2xl
    └── footer  border-t px-4 py-3 flex justify-end gap-4
```

**Cztery pułapki, na które łatwo się nabrać:**

1. **Breadcrumby są w topbarze, nie w treści strony.** `PageHeader` ich nie zawiera — trafiają tam przez `ApplyBreadcrumb` lub manifest trasy. Pierwszy element to zawsze ikona domu linkująca do `/backend`.
2. **Pasek aktywnej pozycji nawigacji wychodzi poza padding.** `<span class="absolute left-[-12px] top-2 w-1 h-5 rounded-r bg-foreground">`, a kontener ma `-ml-3 pl-3`, żeby było to możliwe. Bez tego aktywna pozycja wygląda inaczej niż w produkcji.
3. **Nagłówek grupy w nawigacji to `text-xs font-medium uppercase tracking-wider text-muted-foreground/70`** — nie `text-overline`.
4. **Sidebar ma własną wyszukiwarkę** pod logo (SearchInput `h-9`), niezależną od tej w topbarze.

Logo: 40×40 `rounded-full` + nazwa, w bloku `p-3 rounded-xl hover:bg-muted`.

Prawa strona topbara, w tej kolejności: status badges → akcje wstrzykiwane → AI dot → wyszukiwarka globalna → przełącznik organizacji → integracje → ustawienia → wiadomości → dzwonek → profil.

---

## Scaffolding strony — `Page.tsx`

```
Page       → div.space-y-6
PageHeader → flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between
             h1.text-xl.sm:text-2xl.font-semibold.leading-tight
             p.text-sm.text-muted-foreground.mt-1
             div.flex.flex-wrap.items-center.gap-2   ← akcje
PageBody   → div.space-y-4
```

**Tytuł strony jest `font-semibold`, nie `font-bold`.** To najczęstszy błąd przy odtwarzaniu z pamięci.

---

## DataTable — układ listy

Kluczowe: **na stronach listowych tytuł i akcja główna są w nagłówku karty tabeli, a nie w `PageHeader`.**

```
div.rounded-lg.border.bg-card
├── div.px-4.py-3.border-b                     ← nagłówek
│   ├── flex sm:items-center sm:justify-between
│   │   ├── h2.text-base.font-semibold          ← tytuł listy
│   │   └── flex.gap-2                          ← odśwież, kolumny, eksport, [Nowy]
│   └── div.mt-3.pt-3.border-t                  ← pasek narzędzi
│       ├── SearchInput (w-72 / w-80) + [Filtry n] + przełącznik widoku
│       └── pasek zaznaczenia: "3 zaznaczone" + akcje masowe
├── div.px-4.py-2.border-b                      ← chipy aktywnych filtrów
├── table
└── div.px-4.py-3.border-t                      ← stopka paginacji
```

Tabela (`primitives/table.tsx`):
- `thead` → `bg-muted/40`
- `th` → `px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap`
- `td` → `px-4 py-2`
- wiersz → `border-b last:border-b-0`, hover `bg-muted/30`
- kolumna zaznaczenia `w-8`; kolumna akcji `w-0 text-right`
- checkbox używa `--accent-indigo` (`#6366f1`), **nie** `--primary`

Paginacja: tekst „Showing 1 to 25 of 312 results" (`tabular-nums`), przyciski stron `size-8 rounded-lg`, aktywna `bg-muted`, select rozmiaru strony po prawej.

**Akcje masowe w DataTable są w pasku narzędzi (inline), nie w pływającym pasku.** Pływający ciemny pasek to wzorzec pipeline'u (niżej) — pomylenie ich sprawia, że prototyp obiecuje inny wzorzec interakcji.

---

## CrudForm

Układ zgrupowany:
```
form
└── div.grid.grid-cols-1.lg:grid-cols-[7fr_3fr].gap-4
    ├── div.space-y-3   ← karty grup
    └── div.space-y-3   ← panel boczny
```

Karta grupy: `rounded-lg border bg-card px-4 py-3 space-y-3`, tytuł `text-sm font-medium`.

`FormHeader` (tryb edycji): `← Wstecz` + tytuł po lewej, akcje po prawej.

**Kolejność przycisków w stopce jest ustalona:** akcje dodatkowe → **Usuń** → **Anuluj** → **Zapisz**.
Zapisz to `Button type="submit"` z ikoną `Save`; w trakcie zapisu ikona zmienia się na `Loader2 animate-spin`, a etykieta na „Zapisywanie…".

Usuń: `variant="destructive-outline"`, nie pełne `destructive`.

---

## Kanban — wzorzec z pipeline'u deali

Źródło: `customers/backend/customers/deals/pipeline/components/`.

Lane:
```
div.flex.flex-none.flex-col.gap-3
├── div.rounded-lg.bg-muted/40.px-4.py-3.5      ← nagłówek jako karta
│   ├── div.h-1.5.w-full.rounded-sm             ← pasek akcentu etapu
│   └── flex.justify-between
│       ├── NAZWA (text-sm font-bold uppercase) + pigułka licznika
│       └── suma etapu (text-sm font-bold)
├── button (dodaj kartę)
└── div.min-h-[40vh].rounded-lg.p-1.5           ← strefa zrzutu
```

Karta: `rounded-lg border bg-card px-4 py-3.5 shadow-xs`, tytuł `text-base font-semibold line-clamp-2`,
chipy `rounded-md px-2.5 py-1 text-xs font-semibold` na tokenach `status-*`,
akcje szybkie ujawniane na hover (`opacity-0 group-hover:opacity-100`) — ale **zawsze widoczne na dotyku i przy focusie**.

Pływający pasek akcji masowych: `fixed bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background rounded-lg shadow-xl`.

---

## Tokeny i skale (nie improwizuj)

| Kontrolka | Wysokość |
|---|---|
| Button default | `h-9 px-4 py-2` (z ikoną `px-3`) |
| Button sm | `h-8 px-3` |
| Button icon | `size-9` |
| Input / SearchInput | `h-9 px-3` |
| Topbar | 61px |

Promienie: `--radius: 0.625rem` → sm 6px, md 8px, lg 10px, xl 16px.

Kolory: **wyłącznie tokeny semantyczne.** Statusy przez `status-{error|success|warning|info|neutral|pink}-{bg|text|border|icon}`, nigdy `text-red-*`. Wykresy przez `chart-*`. Bez nadpisań `dark:` — tokeny same się przełączają.

Pełne zasady: `.ai/ds-rules.md`, komponenty: `.ai/ui-components.md`.

---

## Czego prototyp nie odwzorowuje (i trzeba to powiedzieć wprost)

Dwa świadome odstępstwa, bo to statyczny HTML bez builda:

- **Ikony** to wklejony sprite SVG z lucide, a nie importy `lucide-react`.
- **Teksty** są zaszyte, a nie przepuszczone przez `useT()`.

Oba są niedopuszczalne w kodzie produkcyjnym. Zapisz to w README prototypu, żeby nikt nie potraktował makiety jako wzorca do skopiowania.
