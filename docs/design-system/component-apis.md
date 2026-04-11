# G. Component API Proposals

> Detailed API proposals (props, variants, examples) for Alert, StatusBadge, SectionHeader, FormField, Card, DataTable, EmptyState, FlashMessages, Badge, and Dialog.

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

### Decision: Label style

**Default style:** `text-sm font-medium text-foreground` — consistent with the existing `<Label>` primitive and CrudForm FieldControl. This is the style used in 95% of the backend.

**`overline` variant:** `text-overline font-semibold uppercase tracking-wider text-muted-foreground` — used in portal pages and compact contexts. Available via `labelVariant="overline"`, NOT the default.

**Label rendering implementation:**

```typescript
const labelStyles = {
  default: 'text-sm font-medium text-foreground',
  overline: 'text-overline font-semibold uppercase tracking-wider text-muted-foreground',
}

// In the render:
{label && (
  <Label htmlFor={fieldId} className={labelStyles[labelVariant ?? 'default']}>
    {label}
    {required && <span className="text-destructive ml-0.5">*</span>}
  </Label>
)}
```

**Error message style:** `text-xs text-destructive` with `role="alert"` — consistent with CrudForm.

**Description style:** `text-xs text-muted-foreground` — consistent with CrudForm (but without the Info icon — FormField is simpler).

**Portal forms:** Use `<FormField labelVariant="overline">`. The portal does not need its own component — the variant is sufficient.

**Sharing with CrudForm:** Eventually (after the hackathon), CrudForm FieldControl should extract sub-components `FieldLabel`, `FieldError`, `FieldDescription` to a shared location (`packages/ui/src/primitives/form-field-parts.tsx`). Both FormField and CrudForm FieldControl import them. This ensures consistent styling without duplication. **Do not do this during the hackathon** — too much regression risk in CrudForm.

### Usage examples

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

### Implementation — auto-generated id

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

### Relationship with CrudForm

- CrudForm **does NOT use** FormField — it has its own built-in `FieldControl` (line 3367 of CrudForm.tsx)
- FormField is intended for **standalone forms** (portal, auth, custom pages)
- Long-term: CrudForm may be refactored to use FormField internally, but that is not a hackathon goal
- **No logic duplication** — FormField is a simple wrapper, CrudForm FieldControl also handles loadOptions, field types, validation triggers

### Storybook stories

1. `Default` — label + input + submit
2. `Required` — with asterisk
3. `WithError` — error message visible
4. `WithDescription` — help text
5. `Horizontal` — switch/checkbox layout
6. `Disabled` — disabled state
7. `WithoutLabel` — custom input with aria-label
8. `Composed` — multiple FormFields in a form

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

### Relationship between Badge and StatusBadge

```
StatusBadge (semantic: "what this status MEANS")
  └── Badge (visual: "how it LOOKS")
       └── semantic color tokens (foundation: "WHAT color")
```

**Badge** = low-level visual component. Variants: `default`, `secondary`, `destructive`, `outline`, `muted`, + new: `success`, `warning`, `info`. Has no status mapping logic. Use it when you know the variant:
```tsx
<Badge variant="success">Active</Badge>
```

**StatusBadge** = semantic wrapper. Accepts `variant: StatusBadgeVariant` and **internally renders `<Badge>`** with the appropriate variant + an optional dot indicator. Modules define a `StatusMap` mapping business status → variant:
```tsx
<StatusBadge variant={statusMap[person.status]} dot>{t(`status.${person.status}`)}</StatusBadge>
```

**This is NOT duplication.** Badge is "how to draw a colored pill". StatusBadge is "what color for 'active'?". StatusBadge without Badge makes no sense. Badge without StatusBadge is fine for non-status contexts (e.g., count badge, label badge).

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

### Implementation — StatusBadge renders Badge

```typescript
import { Badge } from './badge'

// Mapping StatusBadge variant → Badge variant (new variants in Badge)
const variantToBadge: Record<StatusBadgeVariant, string> = {
  success: 'success',
  warning: 'warning',
  error:   'destructive',  // Badge uses "destructive" not "error"
  info:    'info',
  neutral: 'muted',        // Badge uses "muted" not "neutral"
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

**Badge CVA — new status variants (add to badge.tsx):**

```typescript
// Existing:
default: 'border-transparent bg-primary text-primary-foreground shadow',
secondary: 'border-transparent bg-secondary text-secondary-foreground',
destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
outline: 'text-foreground',
muted: 'border-transparent bg-muted text-muted-foreground',

// New:
success: 'border-status-success-border bg-status-success-bg text-status-success-text',
warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
info:    'border-status-info-border bg-status-info-bg text-status-info-text',
```

> The `destructive` Badge already exists and uses the `--destructive` token. After color migration in section I, the destructive Badge will automatically use semantic error colors. No need to add a separate `error` variant to Badge.

### How modules define statuses

Each module defines its own `StatusMap`:

```typescript
// packages/core/src/modules/customers/lib/status.ts
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

export const personStatusMap: StatusMap<'active' | 'inactive' | 'archived'> = {
  active: 'success',
  inactive: 'neutral',
  archived: 'warning',
}

// Usage in a component:
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { personStatusMap } from '../lib/status'

<StatusBadge variant={personStatusMap[person.status]} dot>
  {t(`customers.status.${person.status}`)}
</StatusBadge>
```

**Per-module examples:**

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

### Unknown/custom statuses

```typescript
// Fallback for unknown statuses:
<StatusBadge variant={statusMap[status] ?? 'neutral'}>
  {status}
</StatusBadge>
```

### Storybook stories

1. `AllVariants` — success, warning, error, info, neutral
2. `WithDot` — dot indicator
3. `WithStatusMap` — example with personStatusMap
4. `Unknown` — fallback to neutral

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

### Usage examples

**With action:**
```tsx
<Section
  header={{ title: 'Tags', count: tags.length, action: <Button variant="ghost" size="sm" onClick={addTag}>Add</Button> }}
  emptyState={{ title: 'No tags', description: 'Add tags to organize this record' }}
>
  {tags.map(tag => <TagChip key={tag.id} tag={tag} />)}
</Section>
```

**With collapse:**
```tsx
<Section
  header={{ title: 'Activities', count: 12, collapsible: true, defaultCollapsed: false }}
>
  <ActivitiesList items={activities} />
</Section>
```

**Without action (simple):**
```tsx
<Section header={{ title: 'Custom Data' }}>
  <CustomFieldsGrid fields={fields} />
</Section>
```

### How it replaces 15+ existing sections

| Current component | Change |
|-------------------|--------|
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

**No need to migrate immediately** — sections can be refactored opportunistically (Boy Scout Rule). SectionHeader is a composition pattern: the header is new, content remains module-owned.

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

### TypeScript Interface (new version)

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

### Migration guide: old API → new API

| Old (Notice) | New (Alert) | Notes |
|--------------|-------------|-------|
| `variant="error"` | `variant="destructive"` | Name aligned with Button |
| `variant="info"` | `variant="info"` | No change |
| `variant="warning"` | `variant="warning"` | No change |
| `title="..."` | `<AlertTitle>...</AlertTitle>` | Composition pattern |
| `message="..."` | `<AlertDescription>...</AlertDescription>` | Composition pattern |
| `action={<Button>}` | `<AlertAction><Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Retained prop |
| `children` | `children` | Retained — renders inside AlertDescription |

| Old (ErrorNotice) | New (Alert) | Notes |
|--------------------|-------------|-------|
| `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>{defaultTitle}</AlertTitle><AlertDescription>{defaultMsg}</AlertDescription></Alert>` | Defaults must be explicit |
| `title="X" message="Y"` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` | 1:1 mapping |
| `action={btn}` | `<AlertAction>{btn}</AlertAction>` | Explicit slot |

### Backward compatibility

**Approach: backward compatible with deprecation warnings.**

Alert already exists with 5 variants. Changes:
1. **Add** `compact` prop (new, additive)
2. **Add** `dismissible` + `onDismiss` props (new, additive)
3. **Add** `AlertAction` sub-component (new, additive)
4. **Change colors** of Alert to semantic tokens (visual change, not an API change)

**NOT a breaking change** — existing Alert usages work without modification. Only Notice is deprecated.

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

### Color tokens (semantic, instead of hardcoded)

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
7. `WithAction` — with action button
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

- [Components](./components.md) — MVP list with priorities
- [Component Specs](./component-specs.md) — Button, Card, Dialog, Tooltip specifications
- [Token Values](./token-values.md) — tokens used in API proposals
- [Foundations](./foundations.md) — colors, typography, spacing
