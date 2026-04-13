# Token Mapping Tables

Lookup reference for DS Guardian. No prose — just tables.

## Color Mapping: Error

| Current | Replace with | Type |
|---------|-------------|------|
| `text-red-600` | `text-status-error-text` | Regex 1:1 |
| `text-red-700` | `text-status-error-text` | Regex 1:1 |
| `text-red-800` | `text-status-error-text` | Regex 1:1 |
| `text-red-900` | `text-status-error-text` | Regex 1:1 |
| `text-red-500` | `text-status-error-icon` | Regex 1:1 |
| `bg-red-50` | `bg-status-error-bg` | Regex 1:1 |
| `bg-red-100` | `bg-status-error-bg` | Regex 1:1 |
| `bg-red-600` | `bg-destructive` | Manual — solid button bg |
| `border-red-200` | `border-status-error-border` | Regex 1:1 |
| `border-red-300` | `border-status-error-border` | Regex 1:1 |
| `border-red-500` | `border-status-error-border` | Regex 1:1 |
| `text-destructive` | Keep | Already a token |

## Color Mapping: Success (green + emerald)

| Current | Replace with | Type |
|---------|-------------|------|
| `text-green-500` | `text-status-success-text` | Regex 1:1 |
| `text-green-600` | `text-status-success-text` | Regex 1:1 |
| `text-green-700` | `text-status-success-text` | Regex 1:1 |
| `text-green-800` | `text-status-success-text` | Regex 1:1 |
| `bg-green-50` | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-100` | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-200` | `bg-status-success-bg` | Manual — check intensity |
| `border-green-200` | `border-status-success-border` | Regex 1:1 |
| `border-green-300` | `border-status-success-border` | Regex 1:1 |
| `border-green-500` | `border-status-success-border` | Regex 1:1 |
| `text-emerald-300` | `text-status-success-icon` | Manual — dark context |
| `text-emerald-600` | `text-status-success-text` | Regex 1:1 |
| `text-emerald-700` | `text-status-success-text` | Regex 1:1 |
| `text-emerald-800` | `text-status-success-text` | Regex 1:1 |
| `text-emerald-900` | `text-status-success-text` | Regex 1:1 |
| `bg-emerald-50` | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-100` | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-500` | `bg-status-success-icon` | Manual — solid bg |
| `bg-emerald-600` | `bg-status-success-icon` | Manual — solid bg |
| `border-emerald-200` | `border-status-success-border` | Regex 1:1 |
| `border-emerald-300` | `border-status-success-border` | Regex 1:1 |

## Color Mapping: Warning (amber)

| Current | Replace with | Type |
|---------|-------------|------|
| `text-amber-500` | `text-status-warning-icon` | Regex 1:1 |
| `text-amber-800` | `text-status-warning-text` | Regex 1:1 |
| `text-amber-950` | `text-status-warning-text` | Regex 1:1 |
| `bg-amber-50` | `bg-status-warning-bg` | Regex 1:1 |
| `bg-amber-400/10` | `bg-status-warning-bg` | Regex 1:1 |
| `border-amber-200` | `border-status-warning-border` | Regex 1:1 |
| `border-amber-500` | `border-status-warning-border` | Regex 1:1 |
| `border-amber-500/30` | `border-status-warning-border` | Regex 1:1 |

## Color Mapping: Info (blue + sky)

| Current | Replace with | Type |
|---------|-------------|------|
| `text-blue-500` | `text-status-info-icon` | Regex 1:1 |
| `text-blue-600` | `text-status-info-text` | Regex 1:1 |
| `text-blue-700` | `text-status-info-text` | Regex 1:1 |
| `text-blue-800` | `text-status-info-text` | Regex 1:1 |
| `text-blue-900` | `text-status-info-text` | Regex 1:1 |
| `bg-blue-50` | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-100` | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-600` | `bg-status-info-icon` | Manual — solid bg |
| `border-blue-200` | `border-status-info-border` | Regex 1:1 |
| `border-blue-500` | `border-status-info-border` | Regex 1:1 |
| `text-sky-900` | `text-status-info-text` | Regex 1:1 |
| `border-sky-600/30` | `border-status-info-border` | Regex 1:1 |
| `bg-sky-500/10` | `bg-status-info-bg` | Regex 1:1 |

## Color Mapping: DO NOT MIGRATE

| Pattern | Reason |
|---------|--------|
| `text-destructive`, `bg-destructive` | Already semantic tokens |
| `--chart-*` colors | Chart/data viz, not status |
| `text-muted-foreground` | Already semantic |
| `bg-muted`, `bg-accent` | Already semantic |
| Brand colors, gradient stops | Decorative, not status |
| Colors inside `dark:` overrides | Remove the override entirely — tokens handle dark mode |

## Typography Mapping

| Current | Replace with | Context |
|---------|-------------|---------|
| `text-[9px]` | Keep `text-[9px]` | Notification badge count — exception |
| `text-[10px]` | `text-xs` (12px) | Badge small, compact labels |
| `text-[11px]` | `text-overline` (11px) | Uppercase labels, section headers |
| `text-[12px]` | `text-xs` (12px) | Identical to text-xs |
| `text-[13px]` | `text-sm` (14px) | Small buttons, links |
| `text-[14px]` | `text-sm` (14px) | Identical to text-sm |
| `text-[15px]` | `text-base` or `text-sm` | Manual — check context |

## Letter Spacing Mapping

| Current | Replace with |
|---------|-------------|
| `tracking-wider` | Keep |
| `tracking-widest` | `tracking-wider` |
| `tracking-[0.15em]` | `tracking-wider` |

## Component Mapping

| Old | New | Notes |
|-----|-----|-------|
| `<Notice variant="error">` | `<Alert variant="destructive">` | Name aligned with Button |
| `<Notice variant="info">` | `<Alert variant="info">` | No change |
| `<Notice variant="warning">` | `<Alert variant="warning">` | No change |
| `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` | Explicit composition |
| `title="..."` (Notice prop) | `<AlertTitle>...</AlertTitle>` | Composition pattern |
| `message="..."` (Notice prop) | `<AlertDescription>...</AlertDescription>` | Composition pattern |
| `action={<Button>}` (Notice prop) | `<AlertAction><Button></AlertAction>` | Explicit slot |
