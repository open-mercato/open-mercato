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

## Selection Control Color (Checkbox / Radio / Switch ON state)

| Current | Replace with | Notes |
|---------|-------------|-------|
| `data-[state=checked]:bg-primary` | `data-[state=checked]:bg-accent-indigo` | Color contract for selection controls |
| `data-[state=checked]:text-primary-foreground` | `data-[state=checked]:text-accent-indigo-foreground` | |
| `bg-primary` (on Checkbox/Radio/Switch) | `bg-accent-indigo` | Selection only — leave Button `bg-primary` alone |
| Custom `#6366f1` / `#818cf8` hex on toggles | `bg-accent-indigo` | Use the token |

Tokens (defined in `apps/mercato/src/app/globals.css` + `packages/create-app/template/src/app/globals.css`):
- `--accent-indigo` — light `#6366f1`, dark `#818cf8`
- `--accent-indigo-foreground` — `white`

## Disabled State

| Current | Replace with | Notes |
|---------|-------------|-------|
| `disabled:opacity-50` | `disabled:bg-bg-disabled disabled:text-text-disabled disabled:border-border-disabled` | Token-driven, preserves contrast |
| `opacity-50` (in disabled context) | Same as above | Only when used to indicate disabled |
| `text-gray-400` (placeholder/disabled) | `text-muted-foreground` (placeholder) or `text-text-disabled` (disabled) | |

Tokens:
- `--bg-disabled` — `#f7f7f7` light, `oklch(0.25 0 0)` dark
- `--text-disabled` — `#d1d1d1` light, `oklch(0.45 0 0)` dark
- `--border-disabled` — `#ebebeb` light, `oklch(0.30 0 0)` dark

NEVER apply `disabled:text-text-disabled` to placeholder-bearing controls (Input/Select/Textarea) — placeholder must stay readable. The primitive handles this internally.

## Focus Ring (Figma 2-ring halo)

| Current | Replace with |
|---------|-------------|
| `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` | `focus-visible:outline-none focus-visible:shadow-focus` |
| `focus:ring-2 focus:ring-blue-500` | `focus-visible:outline-none focus-visible:shadow-focus` |
| `focus:outline focus:outline-2` | `focus-visible:outline-none focus-visible:shadow-focus` |

Token: `--shadow-focus` = `0 0 0 2px var(--focus-ring-inner), 0 0 0 4px var(--focus-ring-outer)` (white inner ring + soft outer ring).

## Hover State

| Current | Replace with | Notes |
|---------|-------------|-------|
| `hover:bg-primary/90` (on primary buttons) | `hover:bg-primary-hover` | |
| `hover:bg-blue-600` | `hover:bg-primary-hover` | If primary action |

Token: `--primary-hover` — light `oklch(0.145 0 0)`, dark `oklch(0.85 0 0)`.

## Brand Colors (theme-invariant)

Used by SocialButton / FancyButton / brand surfaces. NEVER hardcode brand hex values.

| Current | Replace with |
|---------|-------------|
| `bg-[#1877F2]` (Facebook blue) | `bg-brand-facebook` |
| `bg-[#0A66C2]` (LinkedIn blue) | `bg-brand-linkedin` |
| `bg-[#0061FF]` (Dropbox blue) | `bg-brand-dropbox` |
| `bg-[#181717]` (GitHub black) | `bg-brand-github` |
| `bg-black` (Apple / X) | `bg-brand-apple` / `bg-brand-x` |
| `bg-white border-[#dadce0]` (Google) | `bg-background border-brand-google-stroke` |
| `bg-[#BC9AFF]` (FancyButton violet) | `bg-brand-violet` |
| `bg-[#D4F372]` (FancyButton lime) | `bg-brand-lime` |

Tokens (theme-invariant — same value light & dark):
- `--brand-violet`, `--brand-lime`, `--brand-apple`, `--brand-github`, `--brand-x`, `--brand-google-stroke`, `--brand-facebook`, `--brand-dropbox`, `--brand-linkedin`

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

## Raw HTML → DS Primitive (form controls)

### `<input type="text|email|password|number|tel|url|search">` → `<Input>`

```diff
- import { Search } from 'lucide-react'
+ import { Input } from '@open-mercato/ui/primitives/input'
+ import { Search } from 'lucide-react'

- <div className="relative">
-   <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
-   <input
-     type="text"
-     className="h-9 w-full rounded-md border border-gray-300 pl-9 pr-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
-     placeholder="Search..."
-     value={query}
-     onChange={(e) => setQuery(e.target.value)}
-   />
- </div>
+ <Input
+   type="text"
+   leftIcon={<Search />}
+   placeholder="Search..."
+   value={query}
+   onChange={(e) => setQuery(e.target.value)}
+ />
```

Rules:
- Strip width/height/border/radius/padding/text-size classes — primitive handles them.
- Map size: `h-8` → `size="sm"`, `h-10` → `size="lg"`, `h-9` → default (omit).
- Convert absolute-positioned icons to `leftIcon` / `rightIcon`.
- Replace `border-red-*` with `aria-invalid={...}` (or wrap in `<FormField error={...}>`).
- Drop `disabled:opacity-50` — primitive uses disabled tokens.

### `<input type="checkbox">` → `<Checkbox>` / `<CheckboxField>`

```diff
- import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
+ import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'

- <label className="flex items-center gap-2">
-   <input
-     type="checkbox"
-     checked={notify}
-     onChange={(e) => setNotify(e.target.checked)}
-     className="h-4 w-4 rounded border-gray-300 text-indigo-600"
-   />
-   <span className="text-sm">Email notifications</span>
- </label>
+ <CheckboxField
+   label="Email notifications"
+   checked={notify}
+   onCheckedChange={setNotify}
+ />
```

### `<input type="radio">` → `<Radio>` + `<RadioGroup>`

```diff
+ import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
+ import { RadioField } from '@open-mercato/ui/primitives/radio-field'

- <div>
-   <label><input type="radio" name="mode" value="auto" checked={mode === 'auto'} onChange={() => setMode('auto')} /> Auto</label>
-   <label><input type="radio" name="mode" value="manual" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Manual</label>
- </div>
+ <RadioGroup value={mode} onValueChange={setMode}>
+   <RadioField value="auto" label="Auto" />
+   <RadioField value="manual" label="Manual" />
+ </RadioGroup>
```

### `<select>` → `<Select>` family

```diff
+ import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'

- <select
-   value={status}
-   onChange={(e) => setStatus(e.target.value)}
-   className="h-9 rounded-md border border-gray-300 px-3 text-sm"
- >
-   <option value="">Select status...</option>
-   <option value="active">Active</option>
-   <option value="inactive">Inactive</option>
- </select>
+ <Select value={status || undefined} onValueChange={setStatus}>
+   <SelectTrigger>
+     <SelectValue placeholder="Select status..." />
+   </SelectTrigger>
+   <SelectContent>
+     <SelectItem value="active">Active</SelectItem>
+     <SelectItem value="inactive">Inactive</SelectItem>
+   </SelectContent>
+ </Select>
```

Rules:
- NEVER `<SelectItem value="">` — Radix forbids empty values. Move the empty-state label to `placeholder` on `<SelectValue>`.
- For controlled state where `""` means "nothing selected", pass `value={x || undefined}`.
- `<optgroup label="X">` → `<SelectGroup><SelectLabel>X</SelectLabel>...</SelectGroup>`.

### `<textarea>` → `<Textarea>`

```diff
+ import { Textarea } from '@open-mercato/ui/primitives/textarea'

- <textarea
-   className="min-h-20 w-full rounded-md border border-gray-300 p-2 text-sm focus:ring-2"
-   value={notes}
-   onChange={(e) => setNotes(e.target.value)}
-   maxLength={500}
- />
+ <Textarea
+   value={notes}
+   onChange={(e) => setNotes(e.target.value)}
+   maxLength={500}
+   showCount
+ />
```

### Custom `role="switch"` button → `<Switch>` / `<SwitchField>`

```diff
+ import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

- <button
-   type="button"
-   role="switch"
-   aria-checked={isActive}
-   onClick={() => setIsActive(!isActive)}
-   className={cn('relative h-6 w-11 rounded-full', isActive ? 'bg-indigo-600' : 'bg-gray-300')}
- >
-   <span className={cn('absolute top-0.5 size-5 rounded-full bg-white transition', isActive ? 'left-5' : 'left-0.5')} />
- </button>
+ <SwitchField
+   label="Active"
+   checked={isActive}
+   onCheckedChange={setIsActive}
+ />
```
