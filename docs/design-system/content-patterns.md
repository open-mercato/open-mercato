# W. Content Guidelines + Page Patterns

> Voice & tone, content patterns (labels, errors, empty states), page patterns (dashboard, wizard, settings).

---

### W.1 Voice & Tone Guidelines [POST-HACKATHON]

#### Voice — who we are (constant)

Open Mercato communicates as: **professional, clear, helpful, specific.**

| We are | We are NOT |
|--------|-----------|
| Professional — we respect the user's time | Corporate — no jargon, no buzzwords |
| Clear — one sentence, one meaning | Academic — no "furthermore", "utilize", "leverage" |
| Helpful — we say what to do, not just what went wrong | Marketing — no "amazing", "powerful", "game-changing" |
| Specific — "3 customers deleted" not "operation completed" | Casual — no emoji in UI, no "oops!", no humor in errors |

#### Tone — how we adapt (contextual)

| Context | Tone | Good | Bad |
|---------|------|------|-----|
| Success message | Concise, confirming | "Customer saved" | "Your customer has been successfully saved!" |
| Error (server) | Calm, actionable | "Could not save. Try again or check your connection." | "Error 500: Internal Server Error" |
| Error (validation) | Precise, per-field | "Name is required" | "Please fill in all required fields" |
| Empty state | Encouraging, with CTA | "No invoices yet. Create your first invoice." | "No data found" / "Nothing here!" |
| Destructive confirm | Specific, serious | "Delete 3 customers? This cannot be undone." | "Are you sure?" |
| Tooltip / helper | Concise, informative | "Used for tax calculations" | "This field is used to store the information about..." |
| Loading | Neutral, simple | "Loading customers..." | "Please wait while we fetch your data..." |

#### Content Formulas

**Error message:** `[What happened]. [What to do].`
```
✅ "Could not save changes. Check required fields."
✅ "Connection lost. Changes will sync when you're back online."
❌ "Error 422: Unprocessable Entity"
❌ "Oops! Something went wrong :("
❌ "An unexpected error occurred. Please contact support."
```

**Empty state:** `[Title: what is missing]. [Description: what to do]. [CTA: verb + object]`
```
✅ Title: "No customers yet"
   Description: "Create your first customer to get started."
   CTA: [Add customer]

❌ Title: "No data found"        (too generic)
❌ Title: "Nothing here!"        (too casual)
❌ Title: "0 results"            (technical, not human)
```

**Button label:** `[Verb]` or `[Verb + object]`
```
✅ "Save", "Create invoice", "Delete", "Export CSV"
❌ "Submit", "OK", "Yes", "Click here", "Go"

Confirmation dialog: action = what will happen, cancel = "Cancel"
✅ [Delete 3 customers] [Cancel]
❌ [Yes] [No]
❌ [OK] [Cancel]
```

**Confirmation dialog:** `[Title: What will happen?] / [Description: consequences] / [Action] [Cancel]`
```
✅ Title: "Delete this customer?"
   Description: "This will permanently remove Anna Smith and all related deals, activities, and notes."
   Action: [Delete customer]  Cancel: [Cancel]

❌ Title: "Are you sure?"
   Description: ""
   Action: [OK]  Cancel: [Cancel]
```

#### Formatting Rules

| Rule | Standard | Example |
|------|----------|---------|
| Capitalization | Sentence case everywhere | "Create new invoice" not "Create New Invoice" |
| Exception | ALL CAPS only for overline labels | "CUSTOMER DETAILS" in overline |
| Titles | No period at the end | "No customers yet" |
| Descriptions | With period at the end | "Create your first customer to get started." |
| Button labels | No period | "Save customer" |
| Lists | No periods on items | "• Edit customer" not "• Edit customer." |
| Numbers | Numeric, not spelled out | "3 customers" not "three customers" |
| Abbreviations | Full words in UI | "information" not "info", "application" not "app" |
| i18n | MANDATORY | Every user-facing string via `t()` / `useT()` |

### W.2 Error Placement Guidelines [HACKATHON]

Audit (1.9): 4 feedback systems without guidelines for when to use which.

| Scenario | Component | Placement | Lifetime | Trigger |
|----------|-----------|-----------|----------|---------|
| Save successful | `flash('...', 'success')` | Top-right (desktop) / bottom (mobile) | 3s auto-dismiss | After `createCrud`/`updateCrud` |
| Save failed (server) | `flash('...', 'error')` | Top-right / bottom | 5s auto-dismiss | After failed `createCrud`/`updateCrud` |
| Form validation (general) | `Alert variant="destructive"` | Inline above form | Persistent until fixed | Form submit with errors |
| Field validation | `FormField error="..."` | Below the field | Persistent until fixed | Form submit / on blur |
| No data | `EmptyState` | In place of table/content | Persistent | When `rows.length === 0` |
| No permissions | `Alert variant="warning"` | In place of page content | Persistent | Server response 403 |
| Record not found | `ErrorMessage` | In place of content | Persistent | Server response 404 |
| Destructive action | `useConfirmDialog()` | Modal overlay | Until user decides | Before delete/revoke |
| Async event | `NotificationBell` + panel | Dropdown, persistent | SSE-driven | Server event |
| Long operation progress | `ProgressTopBar` | Page top bar | Lasts until completion | Background job start |

**Rule:** Never use 2 systems simultaneously for the same event. If `flash()` reports a save error, do not also show an `Alert` on the page.

**Feedback priority:** Field error > Form alert > Flash message > Notification. Closest to context = highest priority.

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

| Size | Tailwind | When |
|------|---------|------|
| `1x1` | default (1 column) | KPI number, mini chart, todo list, notifications |
| `2x1` | `sm:col-span-2` | Line chart, wider table, activity feed |
| `full` | full row span | Summary table, timeline, calendar |

#### Widget Anatomy (from patterns in customers/widgets/dashboard/)

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

When a widget has no data: `<p className="text-sm text-muted-foreground">No data for selected period.</p>` — centered in CardContent. Do NOT use EmptyState (too large for a widget). Do NOT hide the widget (user will think it disappeared).

### W.4 Wizard / Stepper Pattern [LATER]

#### When to Use Wizard vs Inline Form

| Question | Wizard | Inline form |
|----------|--------|------------|
| How many steps? | 3 or more | 1-2 |
| Do steps require separate context? | Yes (e.g., step 1: company data, step 2: address, step 3: settings) | No — everything is related |
| Can the user go back to a previous step? | Yes | N/A |
| Do data from step N affect options in step N+1? | Yes (e.g., selected country → address form) | No |

#### Anatomy

```
┌─ Step Indicator ──────────────────────┐
│  (1)───(2)───(3)───(4)               │
│   ●     ●     ○     ○                │
│ Done  Current Next  Next              │
├─ Step Content ────────────────────────┤
│                                       │
│  [Current step form]                  │
│                                       │
├─ Navigation ──────────────────────────┤
│  [← Back]              [Next step →]  │
│                    or  [Complete ✓]    │
└───────────────────────────────────────┘
```

**Step indicator:** Numbered (1/2/3), not labeled — text label goes in the step content title. On mobile: numbers + progress bar (e.g., "Step 2 of 4").

**Navigation rules:**

| Control | Availability | Behavior |
|---------|-------------|----------|
| Back | Always (except step 1) | Goes back preserving data. Does not reset the form. |
| Next | After current step validation | Validation on click, not on change. Error inline. |
| Skip | Only if step is optional — explicit label "Skip this step" | Not the default. Never a ghost button — always explicit text. |
| Cancel | Always | If user entered data → `useConfirmDialog("Discard changes?")`. If not → immediate. |
| Complete (last step) | After validation | Button `default` variant. Label = specific action ("Create organization", not "Finish"). |

**Do not build a Stepper component during the hackathon.** This is a guideline for future implementation. The current onboarding in `packages/onboarding` can adopt it iteratively.

---

## See also

- [Principles](./principles.md) — design principles informing content guidelines
- [Contributor Guardrails](./contributor-guardrails.md) — page templates (List, Detail, Form)
- [Onboarding Guide](./onboarding-guide.md) — content guidelines in the onboarding context
