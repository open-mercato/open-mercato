# Component Quick Reference

## Decision Table: "I need to..."

| I need to... | Use this | Import |
|---|---|---|
| Show an error/success/warning message inline | `<Alert variant="destructive\|success\|warning\|info">` | `@open-mercato/ui/primitives/alert` |
| Show a toast notification | `flash('message', 'success\|error\|warning\|info')` | `@open-mercato/ui/backend/FlashMessages` |
| Confirm a destructive action | `useConfirmDialog()` | `@open-mercato/ui/backend/confirm-dialog` |
| Display entity status (active, draft, etc.) | `<StatusBadge variant={statusMap[status]} dot>` | `@open-mercato/ui/primitives/status-badge` |
| Wrap a form field with label + error | `<FormField label="..." error={...}>` | `@open-mercato/ui/primitives/form-field` |
| Build a section header with count + action | `<SectionHeader title="..." count={n} action={...}>` | `@open-mercato/ui/backend/SectionHeader` |
| Build a collapsible section | `<CollapsibleSection title="...">` | `@open-mercato/ui/backend/SectionHeader` |
| Show loading state | `<LoadingMessage />` or `<Spinner />` | `@open-mercato/ui/backend/detail` / `@open-mercato/ui/primitives/spinner` |
| Show error state | `<ErrorMessage message={...} />` | `@open-mercato/ui/backend/detail` |
| Show empty state | `<EmptyState title="..." description="..." action={...} />` | `@open-mercato/ui/backend/EmptyState` |
| Build a data table with sort/filter/pagination | `<DataTable columns={...} data={...} />` | `@open-mercato/ui/backend/DataTable` |
| Build a CRUD form | `<CrudForm fields={...} onSubmit={...} />` | `@open-mercato/ui/backend/CrudForm` |
| Add a metadata badge (count, tag) | `<Badge variant="secondary">` | `@open-mercato/ui/primitives/badge` |
| Use an icon | `<IconName className="size-4" />` from lucide-react | `lucide-react` |

## FormField

Standalone form field wrapper with label, description, error, and accessibility.

```typescript
type FormFieldProps = {
  label?: string
  id?: string
  required?: boolean
  labelVariant?: 'default' | 'overline'
  description?: ReactNode
  error?: string
  orientation?: 'vertical' | 'horizontal'
  disabled?: boolean
  className?: string
  children: ReactNode
}
```

**Example:**
```tsx
<FormField label="Email" required error={errors.email}>
  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
</FormField>
```

**Rules:**
- Use for standalone forms (portal, auth, custom pages)
- Do NOT wrap CrudForm fields in FormField — CrudForm has its own layout
- Auto-generates `id`, links `htmlFor`, injects `aria-describedby` and `aria-invalid`

## StatusBadge

Semantic status display. Wraps Badge with a dot indicator.

```typescript
type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

type StatusBadgeProps = {
  variant: StatusBadgeVariant
  children: ReactNode
  dot?: boolean
  className?: string
}

type StatusMap<T extends string = string> = Record<T, StatusBadgeVariant>
```

**Example:**
```tsx
// Define per-entity status map
const dealStatusMap: StatusMap<'open' | 'won' | 'lost'> = {
  open: 'info',
  won: 'success',
  lost: 'error',
}

// Use in component
<StatusBadge variant={dealStatusMap[deal.status]} dot>
  {t(`deals.status.${deal.status}`)}
</StatusBadge>
```

**Rules:**
- Use StatusBadge for entity status display — NEVER hardcode colors on Badge
- Define a `StatusMap` per entity type in your module
- Fallback for unknown statuses: `statusMap[status] ?? 'neutral'`

## SectionHeader + CollapsibleSection

Section headers for detail pages.

```typescript
type SectionHeaderProps = {
  title: string
  count?: number
  action?: ReactNode
  className?: string
}
```

**Example:**
```tsx
<SectionHeader
  title="Tags"
  count={tags.length}
  action={<Button variant="ghost" size="sm" onClick={addTag}>Add</Button>}
/>

<CollapsibleSection title="Activities" defaultOpen={true}>
  <ActivitiesList items={activities} />
</CollapsibleSection>
```

## Alert

Inline feedback messages. Replaces deprecated `Notice` component.

**Variants:** `default`, `destructive` (error), `success`, `warning`, `info`

```tsx
<Alert variant="destructive">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>
```

**Rules:**
- Use `destructive` (not `error`) — aligned with Button variant naming
- Use composition pattern: `AlertTitle` + `AlertDescription` (not props)
- For transient feedback, use `flash()` instead

## Badge Status Variants

Badge has status variants for non-StatusBadge contexts:

| Variant | Token classes |
|---------|--------------|
| `success` | `border-status-success-border bg-status-success-bg text-status-success-text` |
| `warning` | `border-status-warning-border bg-status-warning-bg text-status-warning-text` |
| `info` | `border-status-info-border bg-status-info-bg text-status-info-text` |
| `error` | `border-status-error-border bg-status-error-bg text-status-error-text` |
| `neutral` | `border-status-neutral-border bg-status-neutral-bg text-status-neutral-text` |

## Button Variant Guide

| Scenario | Variant | Size |
|----------|---------|------|
| Primary action (Save, Create, Submit) | `default` | `default` |
| Supporting action (Cancel, Back, Export) | `outline` | `default` |
| Destructive action (Delete, Remove) | `destructive` | `default` |
| Low-priority action (Reset, Clear) | `ghost` | `sm` |
| Inline link-style action | `link` | `sm` |
| Muted context (toolbar, compact) | `muted` | `sm` |

Rule 1-1-N: Max 1 `default`, max 1 `destructive`, any number of others per section.

## Icon Sizes

| Size class | Pixels | When to use |
|-----------|--------|-------------|
| `size-3` | 12px | Compact contexts, inline with text-xs |
| `size-4` | 16px | Default — most icons |
| `size-5` | 20px | Emphasized icons, page headers |
| `size-6` | 24px | Large icons, empty states |

Always use `lucide-react`. Never inline `<svg>`. Icon-only buttons MUST have `aria-label`.

## Typography Scale

| Role | Tailwind | When to use |
|------|----------|-------------|
| Page title | `text-2xl font-bold tracking-tight` | Page header (one per page) |
| Section title | `text-xl font-semibold` | Major sections |
| Subsection | `text-sm font-semibold` | Detail page sections, card titles |
| Body | `text-sm` | Default body text |
| Body large | `text-base` | Emphasized body |
| Caption | `text-xs text-muted-foreground` | Secondary info, timestamps |
| Label | `text-sm font-medium` | Form labels |
| Overline | `text-overline font-semibold uppercase tracking-wider` | Section labels, category tags |
| Code | `text-sm font-mono` | Code snippets |
