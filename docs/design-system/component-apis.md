# G. Component API Proposals

> Szczegółowe propozycje API (props, variants, examples) dla Alert, StatusBadge, SectionHeader, FormField, Card, DataTable, EmptyState, FlashMessages, Badge i Dialog.

---

## G.1 FormField

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type FormFieldProps = {
  /** Visible label text. If omitted, field is label-less (aria-label should be on input). */
  label?: string
  /** Auto-generated if not provided. Links label → input via htmlFor/id. */
  id?: string
  /** Show required indicator (*) next to label */
  required?: boolean
  /** Label variant. 'default' = text-sm font-medium (backend forms). 'overline' = text-overline font-semibold uppercase tracking-wider (portal/compact contexts). */
  labelVariant?: 'default' | 'overline'
  /** Help text below input */
  description?: ReactNode
  /** Error message below input (replaces description when present) */
  error?: string
  /** Layout direction */
  orientation?: 'vertical' | 'horizontal'
  /** Disabled state — propagates to label styling */
  disabled?: boolean
  /** Additional className on root wrapper */
  className?: string
  /** The input element (slot) */
  children: ReactNode
}
```

### Decyzja: Label style

**Domyslny styl:** `text-sm font-medium text-foreground` — spojny z istniejacym `<Label>` primitive i CrudForm FieldControl. To jest styl uzywany w 95% backendu.

**Wariant `overline`:** `text-overline font-semibold uppercase tracking-wider text-muted-foreground` — uzywany w portal pages i kompaktowych kontekstach. Dostepny przez `labelVariant="overline"`, NIE jest domyslny.

**Implementacja label rendering:**

```typescript
const labelStyles = {
  default: 'text-sm font-medium text-foreground',
  overline: 'text-overline font-semibold uppercase tracking-wider text-muted-foreground',
}

// W renderze:
{label && (
  <Label htmlFor={fieldId} className={labelStyles[labelVariant ?? 'default']}>
    {label}
    {required && <span className="text-destructive ml-0.5">*</span>}
  </Label>
)}
```

**Error message style:** `text-xs text-destructive` z `role="alert"` — spojny z CrudForm.

**Description style:** `text-xs text-muted-foreground` — spojny z CrudForm (ale bez ikony Info — FormField jest prostszy).

**Portal forms:** Uzywaja `<FormField labelVariant="overline">`. Portal nie potrzebuje wlasnego komponentu — wystarczy wariant.

**Wspoldzielenie z CrudForm:** Docelowo (po hackathonie) CrudForm FieldControl powinien wyciagnac sub-komponenty `FieldLabel`, `FieldError`, `FieldDescription` do wspolnej lokalizacji (`packages/ui/src/primitives/form-field-parts.tsx`). FormField i CrudForm FieldControl oba je importuja. To zapewnia spojny styl bez duplikacji. **Nie robic tego na hackathonie** — za duze ryzyko regresji w CrudForm.

### Przyklady uzycia

**Default (vertical):**
```tsx
<FormField label="Email" required error={errors.email}>
  <Input
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
</FormField>
```

**Horizontal layout:**
```tsx
<FormField label="Active" orientation="horizontal">
  <Switch checked={isActive} onCheckedChange={setIsActive} />
</FormField>
```

**With description:**
```tsx
<FormField
  label="API Key"
  description="Your API key is used for authentication. Keep it secret."
  error={errors.apiKey}
>
  <Input type="password" value={apiKey} onChange={...} />
</FormField>
```

**Without label (custom input):**
```tsx
<FormField error={errors.color}>
  <ColorPicker value={color} onChange={setColor} aria-label="Pick a color" />
</FormField>
```

### Implementacja — auto-generated id

```typescript
const generatedId = React.useId()
const fieldId = props.id ?? generatedId
const descriptionId = props.description ? `${fieldId}-desc` : undefined
const errorId = props.error ? `${fieldId}-error` : undefined

// Clones child to inject id, aria-describedby, aria-invalid
const child = React.cloneElement(children, {
  id: fieldId,
  'aria-describedby': [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
  'aria-invalid': !!props.error,
  'aria-required': props.required,
})
```

### Relacja z CrudForm

- CrudForm **NIE uzywa** FormField — ma wlasny wbudowany `FieldControl` (linia 3367 CrudForm.tsx)
- FormField jest przeznaczony do **standalone forms** (portal, auth, custom pages)
- Dlugoterminowo: CrudForm moze byc refaktorowany zeby uzywac FormField wewnetrznie, ale to nie jest cel hackathonu
- **Brak duplikacji logiki** — FormField jest prosty wrapper, CrudForm FieldControl obsluguje tez loadOptions, field types, validation triggers

### Storybook stories

1. `Default` — label + input + submit
2. `Required` — z gwiazdka
3. `WithError` — error message visible
4. `WithDescription` — help text
5. `Horizontal` — switch/checkbox layout
6. `Disabled` — disabled state
7. `WithoutLabel` — custom input z aria-label
8. `Composed` — kilka FormField w formularzu

### Test cases

- Unit: renders label, links htmlFor→id, shows error, shows description, hides description when error present
- Unit: auto-generates id when not provided
- Unit: injects aria-describedby, aria-invalid on child
- Unit: horizontal orientation renders flex-row
- a11y: axe-core passes on all variants

### Accessibility checklist

- [ ] Label linked to input via htmlFor/id
- [ ] `aria-describedby` links input to description/error
- [ ] `aria-invalid="true"` when error present
- [ ] `aria-required="true"` when required
- [ ] Error message has `role="alert"`
- [ ] Required indicator is visible AND communicated to screen readers

---

## G.2 StatusBadge

### Relacja Badge vs StatusBadge

```
StatusBadge (semantic: "co ten status ZNACZY")
  └── Badge (visual: "jak to WYGLĄDA")
       └── semantic color tokens (foundation: "JAKIM kolorem")
```

**Badge** = niskopoziomowy komponent wizualny. Warianty: `default`, `secondary`, `destructive`, `outline`, `muted`, + nowe: `success`, `warning`, `info`. Nie ma logiki mapowania statusów. Używasz go kiedy znasz wariant:
```tsx
<Badge variant="success">Active</Badge>
```

**StatusBadge** = semantyczny wrapper. Przyjmuje `variant: StatusBadgeVariant` i **wewnętrznie renderuje `<Badge>`** z odpowiednim wariantem + opcjonalny dot indicator. Moduły definiują `StatusMap` mapujący business status → variant:
```tsx
<StatusBadge variant={statusMap[person.status]} dot>{t(`status.${person.status}`)}</StatusBadge>
```

**To NIE jest duplikacja.** Badge to "jak rysować kolorowy pill". StatusBadge to "jaki kolor dla 'active'?". StatusBadge bez Badge nie ma sensu. Badge bez StatusBadge jest OK dla non-status contexów (np. count badge, label badge).

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export type StatusBadgeProps = {
  /** Visual variant — maps to semantic color tokens */
  variant: StatusBadgeVariant
  /** Badge text */
  children: ReactNode
  /** Show colored dot before text */
  dot?: boolean
  /** Additional className */
  className?: string
}

/**
 * Helper: map arbitrary status string to variant.
 * Modules define their own mapping.
 */
export type StatusMap<T extends string = string> = Record<T, StatusBadgeVariant>
```

### Implementacja — StatusBadge renderuje Badge

```typescript
import { Badge } from './badge'

// Mapowanie StatusBadge variant → Badge variant (nowe warianty w Badge)
const variantToBadge: Record<StatusBadgeVariant, string> = {
  success: 'success',
  warning: 'warning',
  error:   'destructive',  // Badge uzywa "destructive" nie "error"
  info:    'info',
  neutral: 'muted',        // Badge uzywa "muted" nie "neutral"
}

export function StatusBadge({ variant, dot, children, className }: StatusBadgeProps) {
  return (
    <Badge variant={variantToBadge[variant]} className={className}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </Badge>
  )
}
```

**Badge CVA — nowe warianty status (dodac do badge.tsx):**

```typescript
// Istniejace:
default: 'border-transparent bg-primary text-primary-foreground shadow',
secondary: 'border-transparent bg-secondary text-secondary-foreground',
destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
outline: 'text-foreground',
muted: 'border-transparent bg-muted text-muted-foreground',

// Nowe:
success: 'border-status-success-border bg-status-success-bg text-status-success-text',
warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
info:    'border-status-info-border bg-status-info-bg text-status-info-text',
```

> `destructive` Badge juz istnieje i uzywa `--destructive` token. Po migracji kolorow w sekcji I, destructive Badge automatycznie bedzie uzywal semantic error colors. Nie trzeba dodawac oddzielnego `error` wariantu do Badge.

### Jak moduly definiuja statusy

Kazdy modul definiuje swoj `StatusMap`:

```typescript
// packages/core/src/modules/customers/lib/status.ts
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

export const personStatusMap: StatusMap<'active' | 'inactive' | 'archived'> = {
  active: 'success',
  inactive: 'neutral',
  archived: 'warning',
}

// Uzycie w komponencie:
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { personStatusMap } from '../lib/status'

<StatusBadge variant={personStatusMap[person.status]} dot>
  {t(`customers.status.${person.status}`)}
</StatusBadge>
```

**Przyklady per-modul:**

```typescript
// Sales documents
const documentStatusMap: StatusMap = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
}

// Currencies
const currencyStatusMap: StatusMap = {
  active: 'success',
  inactive: 'neutral',
  base: 'info',
}

// Workflows
const workflowStatusMap: StatusMap = {
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  pending: 'neutral',
}
```

### Unknown/custom statusy

```typescript
// Fallback dla nieznanych statusow:
<StatusBadge variant={statusMap[status] ?? 'neutral'}>
  {status}
</StatusBadge>
```

### Storybook stories

1. `AllVariants` — success, warning, error, info, neutral
2. `WithDot` — dot indicator
3. `WithStatusMap` — przyklad z personStatusMap
4. `Unknown` — fallback do neutral

### Test cases

- Unit: renders correct variant classes
- Unit: renders dot when `dot={true}`
- Unit: renders children text
- a11y: sufficient contrast for all variants in light + dark mode

### Accessibility checklist

- [ ] Text has sufficient contrast (AA minimum) on colored background
- [ ] Dark mode colors maintain contrast
- [ ] Dot is decorative (`aria-hidden="true"`)

---

## G.3 SectionHeader

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type SectionHeaderProps = {
  /** Section title */
  title: string
  /** Optional item count badge */
  count?: number
  /** Action button(s) on the right */
  action?: ReactNode
  /** Enable collapse/expand */
  collapsible?: boolean
  /** Controlled collapsed state */
  collapsed?: boolean
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Default collapsed state (uncontrolled) */
  defaultCollapsed?: boolean
  /** Additional className */
  className?: string
}

export type SectionProps = {
  /** Section header props (or custom header via children) */
  header: SectionHeaderProps
  /** Empty state — rendered when children is null/empty */
  emptyState?: {
    title: string
    description?: string
    action?: { label: string; onClick: () => void }
  }
  /** Section content */
  children?: ReactNode
  /** Additional className on content wrapper */
  contentClassName?: string
}
```

### Przyklady uzycia

**Z akcja:**
```tsx
<Section
  header={{ title: 'Tags', count: tags.length, action: <Button variant="ghost" size="sm" onClick={addTag}>Add</Button> }}
  emptyState={{ title: 'No tags', description: 'Add tags to organize this record' }}
>
  {tags.map(tag => <TagChip key={tag.id} tag={tag} />)}
</Section>
```

**Z collapse:**
```tsx
<Section
  header={{ title: 'Activities', count: 12, collapsible: true, defaultCollapsed: false }}
>
  <ActivitiesList items={activities} />
</Section>
```

**Bez akcji (prosty):**
```tsx
<Section header={{ title: 'Custom Data' }}>
  <CustomFieldsGrid fields={fields} />
</Section>
```

### Jak zastepuje 15+ istniejacych sekcji

| Obecny komponent | Zmiana |
|-----------------|--------|
| `TagsSection` | `<Section header={{ title, count, action }}>` + tag content |
| `ActivitiesSection` | `<Section header={{ title, count, collapsible }}>` + activity list |
| `AddressesSection` | `<Section header={{ title, count, action }}>` + address tiles |
| `DealsSection` | `<Section header={{ title, count }}>` + deal cards |
| `CustomDataSection` | `<Section header={{ title }}>` + custom fields |
| `TasksSection` | `<Section header={{ title, count, action }}>` + task list |
| `CompanyPeopleSection` | `<Section header={{ title, count }}>` + people list |
| Sales `ItemsSection` | `<Section header={{ title, count, action }}>` + line items table |
| Sales `PaymentsSection` | `<Section header={{ title, count }}>` + payments list |
| Sales `ShipmentsSection` | `<Section header={{ title, count }}>` + shipments list |

**Nie trzeba migrować od razu** — sekcje moga byc refaktorowane przy okazji (Boy Scout Rule). SectionHeader jest composition pattern: header jest nowy, content pozostaje wlasnoscia modulu.

### Storybook stories

1. `Default` — title only
2. `WithCount` — title + count badge
3. `WithAction` — title + action button
4. `Collapsible` — expand/collapse
5. `CollapsedByDefault` — starts collapsed
6. `WithEmptyState` — no children, empty state visible
7. `FullExample` — all features combined

### Test cases

- Unit: renders title, count badge, action
- Unit: collapse toggle works (click → hide content)
- Unit: empty state renders when no children
- Unit: controlled collapsed state
- a11y: collapsible uses `aria-expanded`

### Accessibility checklist

- [ ] Title is semantic heading (`<h3>` or `role="heading"`)
- [ ] Collapse button has `aria-expanded`
- [ ] Collapse button has descriptive `aria-label` ("Collapse Tags section")
- [ ] Count is communicated to screen readers

---

## G.4 Alert (unified)

### TypeScript Interface (nowa wersja)

```typescript
import type { ReactNode } from 'react'

export type AlertVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info'

export type AlertProps = {
  variant?: AlertVariant
  /** Compact mode — less padding, no icon */
  compact?: boolean
  /** Dismissible — shows close button */
  dismissible?: boolean
  /** Callback when dismissed */
  onDismiss?: () => void
  /** Additional className */
  className?: string
  /** Role override — default: "alert" for destructive/warning, "status" for others */
  role?: 'alert' | 'status'
  children: ReactNode
}

// Sub-components (composition pattern):
export type AlertTitleProps = React.HTMLAttributes<HTMLHeadingElement>
export type AlertDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>
export type AlertActionProps = { children: ReactNode; className?: string }
```

### Migration guide: stary API → nowy API

| Stary (Notice) | Nowy (Alert) | Uwagi |
|-----------------|-------------|-------|
| `variant="error"` | `variant="destructive"` | Nazwa alignowana z Button |
| `variant="info"` | `variant="info"` | Bez zmian |
| `variant="warning"` | `variant="warning"` | Bez zmian |
| `title="..."` | `<AlertTitle>...</AlertTitle>` | Composition pattern |
| `message="..."` | `<AlertDescription>...</AlertDescription>` | Composition pattern |
| `action={<Button>}` | `<AlertAction><Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Zachowany prop |
| `children` | `children` | Zachowany — renders inside AlertDescription |

| Stary (ErrorNotice) | Nowy (Alert) | Uwagi |
|----------------------|-------------|-------|
| `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>{defaultTitle}</AlertTitle><AlertDescription>{defaultMsg}</AlertDescription></Alert>` | Defaults trzeba explicit |
| `title="X" message="Y"` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` | 1:1 mapping |
| `action={btn}` | `<AlertAction>{btn}</AlertAction>` | Explicit slot |

### Backward compatibility

**Podejscie: backward compatible z deprecation warnings.**

Alert juz istnieje z 5 wariantami. Zmiany:
1. **Dodac** `compact` prop (nowy, additive)
2. **Dodac** `dismissible` + `onDismiss` props (nowy, additive)
3. **Dodac** `AlertAction` sub-component (nowy, additive)
4. **Zmiana kolorow** Alert na semantic tokens (visual change, nie API change)

**NIE jest breaking change** — istniejace uzycia Alert dzialaja bez zmian. Tylko Notice jest deprecated.

### Dismissible behavior

```typescript
const [visible, setVisible] = React.useState(true)

if (!visible) return null

return (
  <div role={role} className={cn(alertVariants({ variant }), className)}>
    {/* ... content ... */}
    {dismissible && (
      <IconButton
        variant="ghost"
        size="xs"
        aria-label="Dismiss"
        onClick={() => { setVisible(false); onDismiss?.() }}
        className="absolute top-2 right-2"
      >
        <X className="size-3" />
      </IconButton>
    )}
  </div>
)
```

### Color tokens (semantic, zamiast hardcoded)

```typescript
const alertVariants = cva('...base...', {
  variants: {
    variant: {
      default:     'border-border bg-card text-card-foreground',
      destructive: 'border-status-error-border bg-status-error-bg text-status-error-text [&_svg]:text-status-error-icon',
      success:     'border-status-success-border bg-status-success-bg text-status-success-text [&_svg]:text-status-success-icon',
      warning:     'border-status-warning-border bg-status-warning-bg text-status-warning-text [&_svg]:text-status-warning-icon',
      info:        'border-status-info-border bg-status-info-bg text-status-info-text [&_svg]:text-status-info-icon',
    },
  },
})
```

### Storybook stories

1. `Default` — neutral alert
2. `Destructive` — error state
3. `Success` — success state
4. `Warning` — warning state
5. `Info` — informational
6. `WithTitle` — title + description
7. `WithAction` — z action button
8. `Dismissible` — close button
9. `Compact` — compact mode
10. `MigrationFromNotice` — side-by-side old Notice vs new Alert

### Test cases

- Unit: renders all 5 variants
- Unit: renders title, description, action
- Unit: dismissible — click close → hidden
- Unit: compact mode — smaller padding
- Unit: correct role attribute per variant
- a11y: `role="alert"` for destructive/warning, `role="status"` for info/success

### Accessibility checklist

- [ ] `role="alert"` for destructive and warning (announced immediately)
- [ ] `role="status"` for info and success (polite announcement)
- [ ] Dismiss button has `aria-label="Dismiss"`
- [ ] Icon is `aria-hidden="true"` (decorative)
- [ ] Contrast ratio meets AA for all variants in light + dark mode

---

---

## See also

- [Components](./components.md) — lista MVP z priorytetami
- [Component Specs](./component-specs.md) — specyfikacje Button, Card, Dialog, Tooltip
- [Token Values](./token-values.md) — tokeny używane w propozycjach API
- [Foundations](./foundations.md) — kolory, typografia, spacing
