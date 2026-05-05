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
| Render text input (text/email/password/number/tel/url/search) | `<Input leftIcon={...} rightIcon={...} size="sm\|default\|lg" />` | `@open-mercato/ui/primitives/input` |
| Render multi-line text with optional char counter | `<Textarea showCount maxLength={...} />` | `@open-mercato/ui/primitives/textarea` |
| Render dropdown / single-select | `<Select><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>...</SelectContent></Select>` | `@open-mercato/ui/primitives/select` |
| Render checkbox (binary toggle inside form) | `<Checkbox checked={...} onCheckedChange={...} />` | `@open-mercato/ui/primitives/checkbox` |
| Render checkbox with label + description | `<CheckboxField label="..." description="..." />` | `@open-mercato/ui/primitives/checkbox-field` |
| Render binary toggle (immediate effect, e.g. setting on/off) | `<Switch />` or `<SwitchField label="..." />` | `@open-mercato/ui/primitives/switch` / `@open-mercato/ui/primitives/switch-field` |
| Render mutually-exclusive choice | `<RadioGroup><Radio value="..." />...</RadioGroup>` or `<RadioField label="..." />` | `@open-mercato/ui/primitives/radio` / `@open-mercato/ui/primitives/radio-field` |
| Show hover hint with arrow | `<SimpleTooltip content="..." arrow>` | `@open-mercato/ui/primitives/tooltip` |
| Show inline link styled as button | `<LinkButton variant="..." />` | `@open-mercato/ui/primitives/link-button` |
| Show OAuth/social sign-in button | `<SocialButton brand="apple\|github\|google\|x\|facebook\|dropbox\|linkedin" />` | `@open-mercato/ui/primitives/social-button` |
| Show marketing CTA with brand gradient | `<FancyButton intent="..." />` | `@open-mercato/ui/primitives/fancy-button` |

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

## Form Primitives — Raw HTML → DS Replacement

NEVER use raw HTML form controls. Always use the DS primitive equivalent.

| Raw HTML | Use this | Why |
|---|---|---|
| `<input type="text\|email\|password\|number\|tel\|url\|search">` | `<Input>` | Token-driven focus/disabled, icon slots, FormField error pickup |
| `<input type="checkbox">` | `<Checkbox>` (or `<CheckboxField>`) | Indeterminate, indigo selection, focus halo |
| `<input type="radio">` | `<Radio>` inside `<RadioGroup>` (or `<RadioField>`) | Group keyboard nav, indigo selection, focus halo |
| `<select>` | `<Select>` family | Themed popper, scroll on long lists, no empty-string items |
| `<textarea>` | `<Textarea>` | Token disabled/focus, optional `showCount` |
| Custom `role="switch"` button | `<Switch>` (or `<SwitchField>`) | Figma-aligned 28×16 track, indigo on, hit area 32×20 |

## Input

Single-line text input (text, email, password, number, tel, url, search).

```typescript
type InputProps = {
  size?: 'sm' | 'default' | 'lg'      // h-8 / h-9 / h-10
  leftIcon?: ReactNode                 // size-4 lucide icon
  rightIcon?: ReactNode
  className?: string                   // wrapper
  inputClassName?: string              // inner <input>
} & React.InputHTMLAttributes<HTMLInputElement>
```

**Example:**
```tsx
<FormField label="Email" required error={errors.email}>
  <Input
    type="email"
    leftIcon={<Mail />}
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
</FormField>
```

**Rules:**
- NEVER pass width/height/border/radius/padding/text-size in `className` — DS scales handle them
- For error styling: do NOT add `border-red-*` — set `aria-invalid={!!error}` (FormField does this automatically)
- Convert absolute-positioned input icons to `leftIcon` / `rightIcon` slots
- Do NOT add `disabled:opacity-50` — primitive uses `--bg-disabled` / `--text-disabled` / `--border-disabled` tokens

## Textarea

Multi-line text input.

```typescript
type TextareaProps = {
  showCount?: boolean         // shows aria-live counter under field
  maxLength?: number          // bounds counter, no typing past max
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>
```

**Example:**
```tsx
<FormField label="Notes">
  <Textarea showCount maxLength={500} rows={4} />
</FormField>
```

**Rules:**
- Default `min-h-[80px]`, `resize-y` — do NOT override unless layout demands it
- Counter renders below field, switches to `text-destructive` when over max
- For CrudForm fields, set `maxLength` and `showCount` directly on the `CrudField` definition

## Select

Dropdown / single-select. Built on Radix Select.

```tsx
import {
  Select, SelectGroup, SelectValue, SelectTrigger,
  SelectContent, SelectLabel, SelectItem, SelectSeparator,
} from '@open-mercato/ui/primitives/select'

<Select value={status || undefined} onValueChange={setStatus}>
  <SelectTrigger size="sm">
    <SelectValue placeholder={t('module.status.placeholder', 'Select status')} />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>{t('module.status.label', 'Status')}</SelectLabel>
      <SelectItem value="active">Active</SelectItem>
      <SelectItem value="inactive">Inactive</SelectItem>
      <SelectSeparator />
      <SelectItem value="archived">Archived</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

**Rules:**
- NEVER use `<SelectItem value="">` — Radix forbids empty values. Use `placeholder` on `SelectValue` instead.
- For optional fields with controlled state, pass `value={x || undefined}` so placeholder shows when empty.
- Trigger sizes match `<Input>`: `sm` (h-8), default (h-9), `lg` (h-10).
- Long lists scroll automatically — do NOT add `max-h` or `overflow` overrides on `SelectContent`.

## Checkbox / CheckboxField

Binary toggle inside a form (state visible only on submit, not immediate effect).

```typescript
type CheckboxFieldProps = {
  label: ReactNode
  sublabel?: ReactNode
  description?: ReactNode
  badge?: ReactNode
  link?: ReactNode
  flip?: boolean                  // checkbox on right (default: left)
} & CheckboxProps
```

**Example:**
```tsx
<CheckboxField
  label={t('settings.notifications.label', 'Email notifications')}
  description={t('settings.notifications.help', 'Receive updates about your account')}
  checked={notify}
  onCheckedChange={setNotify}
/>
```

**Rules:**
- ON state uses `--accent-indigo` (#6366f1). NEVER override with `data-[state=checked]:bg-primary`.
- Use `<CheckboxField>` whenever the checkbox has a label — it handles `htmlFor`, alignment, and disabled propagation.
- For indeterminate state, pass `checked="indeterminate"`.

## Switch / SwitchField

Binary toggle with **immediate effect** (e.g., feature flag, sync on/off).

```typescript
type SwitchFieldProps = {
  label: ReactNode
  sublabel?: ReactNode
  description?: ReactNode
  badge?: ReactNode
  link?: ReactNode
  flip?: boolean                  // switch on left (default: switch on right)
} & SwitchProps
```

**Example:**
```tsx
<SwitchField
  label={t('users.active.label', 'Active')}
  description={t('users.active.help', 'Disable to revoke access immediately')}
  checked={isActive}
  onCheckedChange={toggleActive}
/>
```

**Decision: Switch vs Checkbox**
- **Switch** — immediate effect (toggle a setting that changes behavior right now)
- **Checkbox** — deferred state (collected on form submit)

**Rules:**
- ON state uses `--accent-indigo` (color contract with Checkbox/Radio).
- Track is 28×16, thumb 12px — do NOT override sizing.
- `<SwitchField>` defaults to label-LEFT, switch-RIGHT (preference style). Use `flip` to swap.

## Radio / RadioGroup / RadioField

Mutually-exclusive choice from a list. Built on Radix RadioGroup.

```tsx
import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'

// Pattern A — manual layout (cards, table rows)
<RadioGroup value={mode} onValueChange={setMode}>
  <label className="flex items-center gap-2">
    <Radio value="auto" />
    <span>{t('settings.mode.auto', 'Automatic')}</span>
  </label>
</RadioGroup>

// Pattern B — labeled list
<RadioGroup value={mode} onValueChange={setMode}>
  <RadioField value="inherit" label={t('users.role.inherit', 'Inherit from roles')} />
  <RadioField value="override" label={t('users.role.override', 'Override for this user')} description={...} />
</RadioGroup>
```

**Rules:**
- ON state uses `--accent-indigo` (color contract).
- Always wrap `<Radio>` in `<RadioGroup>` — provides keyboard navigation and shared name.
- For card-style selectors with selected highlighting, use Pattern A and keep custom card styling.

## Tooltip / SimpleTooltip

Hover hint with optional arrow.

```tsx
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'

<SimpleTooltip content={t('actions.delete.help', 'Permanently delete this item')} arrow>
  <IconButton aria-label={t('common.delete', 'Delete')}>
    <Trash />
  </IconButton>
</SimpleTooltip>
```

**Variants:**
- `default` (dark, high contrast — like iOS) — most use cases
- `light` (white with border) — when dark conflicts with surrounding context

**Sizes:** `sm` (table cells, icon buttons), `default`, `lg` (multi-line / rich content)

**Rules:**
- `arrow` defaults to `true` — keep it on for clarity unless the tooltip is multi-element popover-style.
- Wrap `<IconButton>` in `<SimpleTooltip>` to surface its `aria-label` visually on hover.

## LinkButton / SocialButton / FancyButton

Specialized button primitives.

| Primitive | Use case |
|---|---|
| `<LinkButton>` | Inline text link styled like a button (in body copy, footers, table cells) |
| `<SocialButton brand="...">` | OAuth sign-in (Google / Apple / GitHub / X / Facebook / Dropbox / LinkedIn) |
| `<FancyButton intent="...">` | Marketing CTA with brand-violet/lime gradient (NOT for backend admin) |

**Rules:**
- Brand colors come from `--brand-*` tokens. NEVER hardcode `#1877F2` etc.
- `<FancyButton>` is theme-invariant by design — no `dark:` overrides needed.

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
