# W. Content Guidelines + Page Patterns

> Voice & tone, wzorce treści (labels, errors, empty states), page patterns (dashboard, wizard, settings).

---

### W.1 Voice & Tone Guidelines [POST-HACKATHON]

#### Voice — kim jesteśmy (stałe)

Open Mercato komunikuje się jako: **profesjonalny, jasny, pomocny, konkretny.**

| Jesteśmy | NIE jesteśmy |
|----------|-------------|
| Profesjonalni — szanujemy czas użytkownika | Korporacyjni — bez żargonu, bez buzzwordów |
| Jasni — jedno zdanie, jedno znaczenie | Akademiccy — bez "furthermore", "utilize", "leverage" |
| Pomocni — mówimy co zrobić, nie tylko co poszło źle | Marketingowi — bez "amazing", "powerful", "game-changing" |
| Konkretni — "3 customers deleted" nie "operation completed" | Casualowi — bez emoji w UI, bez "oops!", bez humoru w errorach |

#### Tone — jak się zmieniamy (kontekstowe)

| Kontekst | Ton | Dobrze ✅ | Źle ❌ |
|---------|-----|----------|--------|
| Success message | Zwięzły, potwierdzający | "Customer saved" | "Your customer has been successfully saved!" |
| Error (server) | Spokojny, actionable | "Could not save. Try again or check your connection." | "Error 500: Internal Server Error" |
| Error (validation) | Precyzyjny, per-field | "Name is required" | "Please fill in all required fields" |
| Empty state | Zachęcający, z CTA | "No invoices yet. Create your first invoice." | "No data found" / "Nothing here!" |
| Destructive confirm | Konkretny, poważny | "Delete 3 customers? This cannot be undone." | "Are you sure?" |
| Tooltip / helper | Zwięzły, informacyjny | "Used for tax calculations" | "This field is used to store the information about..." |
| Loading | Neutralny, prosty | "Loading customers..." | "Please wait while we fetch your data..." |

#### Content Formulas

**Error message:** `[Co się stało]. [Co zrobić].`
```
✅ "Could not save changes. Check required fields."
✅ "Connection lost. Changes will sync when you're back online."
❌ "Error 422: Unprocessable Entity"
❌ "Oops! Something went wrong :("
❌ "An unexpected error occurred. Please contact support."
```

**Empty state:** `[Title: brak czego]. [Description: co zrobić]. [CTA: verb + object]`
```
✅ Title: "No customers yet"
   Description: "Create your first customer to get started."
   CTA: [Add customer]

❌ Title: "No data found"        (zbyt generyczne)
❌ Title: "Nothing here!"        (zbyt casual)
❌ Title: "0 results"            (technickie, nie ludzkie)
```

**Button label:** `[Verb]` lub `[Verb + object]`
```
✅ "Save", "Create invoice", "Delete", "Export CSV"
❌ "Submit", "OK", "Yes", "Click here", "Go"

Confirmation dialog: action = co się stanie, cancel = "Cancel"
✅ [Delete 3 customers] [Cancel]
❌ [Yes] [No]
❌ [OK] [Cancel]
```

**Confirmation dialog:** `[Title: Co się stanie?] / [Description: konsekwencje] / [Action] [Cancel]`
```
✅ Title: "Delete this customer?"
   Description: "This will permanently remove Anna Smith and all related deals, activities, and notes."
   Action: [Delete customer]  Cancel: [Cancel]

❌ Title: "Are you sure?"
   Description: ""
   Action: [OK]  Cancel: [Cancel]
```

#### Reguły formatowania

| Reguła | Standard | Przykład |
|--------|----------|---------|
| Capitalization | Sentence case everywhere | "Create new invoice" nie "Create New Invoice" |
| Wyjątek | ALL CAPS tylko dla overline labels | "CUSTOMER DETAILS" w overline |
| Tytuły | Bez kropki na końcu | "No customers yet" |
| Opisy | Z kropką na końcu | "Create your first customer to get started." |
| Button labels | Bez kropki | "Save customer" |
| Listy | Bez kropek na elementach | "• Edit customer" nie "• Edit customer." |
| Liczby | Numerycznie, nie słownie | "3 customers" nie "three customers" |
| Skróty | Pełne słowa w UI | "information" nie "info", "application" nie "app" |
| i18n | OBOWIĄZKOWE | Każdy user-facing string via `t()` / `useT()` |

### W.2 Error Placement Guidelines [HACKATHON]

Audit (1.9): 4 systemy feedbacku bez guidelines kiedy który.

| Scenariusz | Komponent | Placement | Czas życia | Trigger |
|-----------|-----------|-----------|-----------|---------|
| Zapis udany | `flash('...', 'success')` | Top-right (desktop) / bottom (mobile) | 3s auto-dismiss | Po `createCrud`/`updateCrud` |
| Zapis nieudany (server) | `flash('...', 'error')` | Top-right / bottom | 5s auto-dismiss | Po failed `createCrud`/`updateCrud` |
| Walidacja formularza (ogólna) | `Alert variant="destructive"` | Inline nad formularzem | Persistent do naprawy | Form submit z błędami |
| Walidacja pola | `FormField error="..."` | Pod polem | Persistent do naprawy | Form submit / on blur |
| Brak danych | `EmptyState` | Zamiast tabeli/contentu | Persistent | Gdy `rows.length === 0` |
| Brak uprawnień | `Alert variant="warning"` | Zamiast contentu strony | Persistent | Server response 403 |
| Rekord nie znaleziony | `ErrorMessage` | Zamiast contentu | Persistent | Server response 404 |
| Destructive action | `useConfirmDialog()` | Modal overlay | Do decyzji usera | Przed delete/revoke |
| Async event | `NotificationBell` + panel | Dropdown, persistent | SSE-driven | Server event |
| Long operation progress | `ProgressTopBar` | Top bar strony | Trwa do zakończenia | Background job start |

**Zasada:** Nigdy 2 systemy jednocześnie dla tego samego wydarzenia. Jeśli `flash()` informuje o błędzie zapisu, nie pokazuj jednocześnie `Alert` na stronie.

**Priorytet feedbacku:** Field error > Form alert > Flash message > Notification. Najbliższy kontekstowi = najwyższy priorytet.

### W.3 Dashboard Layout Pattern [LATER]

#### Grid Layout

```tsx
// Dashboard widget grid pattern
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
  {widgets.map((widget) => (
    <Card key={widget.id} className={cn(
      widget.size === '2x1' && 'sm:col-span-2',
      widget.size === 'full' && 'sm:col-span-2 xl:col-span-3 2xl:col-span-4',
    )}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
        {widget.action && <CardAction>{widget.action}</CardAction>}
      </CardHeader>
      <CardContent>
        {widget.content}
      </CardContent>
    </Card>
  ))}
</div>
```

#### Widget Sizing

| Rozmiar | Tailwind | Kiedy |
|---------|---------|-------|
| `1x1` | default (1 column) | KPI number, mini chart, todo list, notifications |
| `2x1` | `sm:col-span-2` | Line chart, wider table, activity feed |
| `full` | full row span | Summary table, timeline, calendar |

#### Widget Anatomy (z patterns w customers/widgets/dashboard/)

```
┌─ CardHeader ───────────────────────┐
│ [Title: text-sm font-medium]  [⟳] │
├─ CardContent ──────────────────────┤
│                                    │
│  Widget content:                   │
│  - KPI: value (text-2xl) + trend   │
│  - List: ul.space-y-3 > li.p-3    │
│  - Chart: recharts component       │
│                                    │
├─ States ───────────────────────────┤
│  Loading: Spinner h-6 centered     │
│  Error: text-sm text-destructive   │
│  Empty: text-sm text-muted-fg      │
│  Settings: form inputs             │
└────────────────────────────────────┘
```

#### Empty Widget

Gdy widget nie ma danych: `<p className="text-sm text-muted-foreground">No data for selected period.</p>` — centered w CardContent. NIE używaj EmptyState (za duży na widget). NIE chowaj widgeta (user pomyśli że zniknął).

### W.4 Wizard / Stepper Pattern [LATER]

#### Kiedy Wizard vs Inline Form

| Pytanie | Wizard | Inline form |
|---------|--------|------------|
| Ile kroków? | ≥3 | 1-2 |
| Kroki wymagają oddzielnego kontekstu? | Tak (np. krok 1: dane firmy, krok 2: adres, krok 3: ustawienia) | Nie — wszystko powiązane |
| User może wrócić do poprzedniego kroku? | Tak | N/A |
| Dane z kroku N wpływają na opcje w kroku N+1? | Tak (np. wybrany kraj → formularz adresu) | Nie |

#### Anatomy

```
┌─ Step Indicator ──────────────────────┐
│  (1)───(2)───(3)───(4)               │
│   ●     ●     ○     ○                │
│ Done  Current Next  Next              │
├─ Step Content ────────────────────────┤
│                                       │
│  [Formularz bieżącego kroku]          │
│                                       │
├─ Navigation ──────────────────────────┤
│  [← Back]              [Next step →]  │
│                    or  [Complete ✓]    │
└───────────────────────────────────────┘
```

**Step indicator:** Numerowany (1/2/3), nie labeled — tekst label w step content title. Na mobile: numerki + progress bar (np. "Step 2 of 4").

**Navigation rules:**

| Kontrolka | Dostępność | Zachowanie |
|-----------|-----------|-----------|
| Back | Zawsze (oprócz kroku 1) | Wraca z zachowaniem danych. Nie resetuje formularza. |
| Next | Po walidacji bieżącego kroku | Walidacja on-click, nie on-change. Error inline. |
| Skip | Tylko jeśli krok opcjonalny — explicit label "Skip this step" | Nie domyślny. Nigdy ghost button — zawsze jawny tekst. |
| Cancel | Zawsze | Jeśli user wpisał dane → `useConfirmDialog("Discard changes?")`. Jeśli nie → natychmiast. |
| Complete (ostatni krok) | Po walidacji | Button `default` variant. Label = konkretna akcja ("Create organization", nie "Finish"). |

**Nie buduj komponentu Stepper na hackathon.** To jest guideline na przyszłą implementację. Obecne onboarding w `packages/onboarding` może go adoptować iteracyjnie.

---

## See also

- [Principles](./principles.md) — zasady projektowe informujące content guidelines
- [Contributor Guardrails](./contributor-guardrails.md) — szablony stron (List, Detail, Form)
- [Onboarding Guide](./onboarding-guide.md) — content guidelines w kontekście onboardingu
