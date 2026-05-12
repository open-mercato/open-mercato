# UI Components Reference

Detailed variant tables, size matrices, props, examples, and MUST rules for every `@open-mercato/ui` primitive. Quick reference (one-line per component) is in [`packages/ui/AGENTS.md`](../packages/ui/AGENTS.md). Foundation rules (color tokens, typography, spacing, decision trees) live in [`.ai/ds-rules.md`](./ds-rules.md).

## Table of Contents

- [Button](#button)
- [IconButton](#iconbutton)
- [LinkButton](#linkbutton)
- [SocialButton](#socialbutton)
- [FancyButton](#fancybutton)
- [Checkbox / CheckboxField](#checkbox--checkboxfield)
- [Input](#input)
- [Textarea](#textarea)
- [Select](#select)
- [Switch / SwitchField](#switch--switchfield)
- [Radio / RadioGroup / RadioField](#radio--radiogroup--radiofield)
- [Tooltip / SimpleTooltip](#tooltip--simpletooltip)
- [Avatar / AvatarStack](#avatar--avatarstack)
- [Kbd / KbdShortcut](#kbd--kbdshortcut)
- [Tag](#tag)
- [TagInput](#taginput)
- [CounterInput](#counterinput)
- [DigitInput](#digitinput)
- [CompactSelect](#compactselect)
- [InlineInput](#inlineinput)
- [InlineSelect](#inlineselect)
- [TimePicker](#timepicker)
- [Alert](#alert)
- [Common patterns](#common-patterns)

---

## Button

```typescript
import { Button } from '@open-mercato/ui/primitives/button'
```

**Variants**:
- `default` (primary CTA) · `destructive` (danger filled)
- `destructive-outline` · `destructive-soft` · `destructive-ghost` (danger family)
- `outline` · `secondary` · `ghost` · `muted` · `link`

**Sizes**: `2xs` (h-7) · `sm` (h-8) · `default` (h-9) · `lg` (h-10) · `icon` (size-9)

All sizes share `rounded-md`. Same-row buttons MUST share `size`.

### MUST rules

1. Always pass `type="button"` explicitly on non-submit buttons.
2. NEVER use raw `<button>` elements.
3. Use `IconButton` (not `Button size="icon"`) for icon-only buttons.
4. Add `hover:bg-transparent` when using `variant="ghost"` for tab-style buttons with underline indicators.
5. Add `h-auto` in compact inline contexts (tag chips, toolbars, inline lists) where fixed height would overflow.

### Same-row size consistency (MUST)

| Pair | Conflict | Fix |
|---|---|---|
| `Button size="icon"` (h-9) ↔ `Button size="sm"` (h-8) | icon vs text mismatch | use `default` for text buttons |
| `IconButton size="default"` (h-8) ↔ `Button size="default"` (h-9) | icon-button is one step smaller | use `IconButton size="lg"` (h-9) |
| Raw `<Link className="h-9 ...">` ↔ `<Button>` | hand-rolled height | wrap with `<Button asChild>` |

**Standardized rows:**
- DataTable toolbar — all `Button` `default` size or `Button size="icon"` (both h-9).
- FilterBar Filters trigger — `default` size, no explicit `className="h-9"`.
- FormActionButtons (Cancel/Save/Delete) — all default size.

**Anti-patterns:** `<Button className="h-9">` (redundant, hides contract from grep), `<Button size="sm">` next to `size="icon"`, raw `<Link>` styled as a button.

> Use the destructive family for danger actions: `destructive` for primary delete CTAs, `destructive-outline` for confirmation dialogs, `destructive-soft` for inline destructive chips, `destructive-ghost` for low-emphasis menu items.

---

## IconButton

```typescript
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
```

**Variants**: `outline` (default) · `ghost` · `white` (white bg with sub-600 icon, for dark surfaces) · `modifiable` (transparent, inherits text — for ghost-on-dark headers)

**Sizes**: `xs` (size-6 / 24px) · `sm` (size-7 / 28px) · `default` (size-8 / 32px) · `lg` (size-9 / 36px)

**Extra props:**
- `fullRadius` (boolean) — pill (`rounded-full`) vs `rounded-md`. Default `false`.
- Pressed/Active state via standard ARIA: `aria-pressed={true}` switches the button to filled-primary styling automatically.

```tsx
// Toggle button (e.g. filter chip)
<IconButton aria-pressed={isOn} variant="ghost" size="sm" type="button" onClick={toggle} aria-label="Toggle filter">
  <Filter className="size-4" />
</IconButton>

// Pill icon button
<IconButton fullRadius variant="outline" size="sm" type="button">
  <Search className="size-4" />
</IconButton>
```

---

## LinkButton

```typescript
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
```

Text-only button styled as an inline link. Use for in-flow actions ("Edit profile", "View all", "Forgot password?") where a full button would be too heavy.

| Variant | Token |
|---|---|
| `gray` | `text-muted-foreground` → `text-foreground` on hover |
| `black` | `text-foreground` |
| `primary` (default) | `text-primary` → `text-primary-hover` |
| `error` | `text-destructive` |
| `modifiable` | `text-current` — inherits from parent |

- `size`: `sm` (text-xs / 16px line) · `default` (text-sm / 20px line)
- `underline`: `always` · `hover` (default) · `none`

```tsx
<LinkButton variant="primary" onClick={onForgot}>Forgot password?</LinkButton>
<LinkButton variant="error" underline="always" asChild>
  <Link href="/account/delete">Delete my account</Link>
</LinkButton>
```

### MUST rules

- Use `LinkButton` (NOT `Button variant="link"`) for new code — `variant="link"` is kept for BC only.
- Set `asChild` when wrapping `<Link>` so the anchor receives the styling.

---

## SocialButton

```typescript
import { SocialButton, type SocialBrand } from '@open-mercato/ui/primitives/social-button'
```

Brand-styled OAuth/sign-in button. Pass the provider's logo as children — the component handles bg/border/text per brand.

- `brand`: `apple` · `github` · `x` · `google` · `facebook` · `dropbox` · `linkedin`
- `appearance`: `filled` (default — brand bg, white text) · `stroke` (white bg, brand-tinted border)
- `iconOnly` (boolean) — square 40×40 icon-only mode

> Note: the visual treatment is named `appearance` (not `style`) to avoid shadowing the native HTML/React `style` (`CSSProperties`) attribute.

Brand colors live as theme-invariant tokens in `globals.css` (`--brand-facebook`, `--brand-linkedin`, etc.).

```tsx
<SocialButton brand="google" appearance="stroke">
  <GoogleIcon /> Continue with Google
</SocialButton>

<SocialButton brand="facebook" iconOnly aria-label="Sign in with Facebook">
  <FacebookIcon />
</SocialButton>
```

### MUST rules

- NEVER hardcode brand hex values — always use `SocialButton`.
- Provide the logo as children; the component does NOT ship logos.
- For Google, both `filled` and `stroke` render the same per Google's brand guidelines.

---

## FancyButton

```typescript
import { FancyButton, type FancyButtonType } from '@open-mercato/ui/primitives/fancy-button'
```

Marketing-grade CTA with gradient bg + dual-shadow ring. Use sparingly — landing pages, AI/premium feature CTAs, brand surfaces.

- `intent`: `neutral` (dark sheen) · `basic` (white with subtle shadow) · `primary` (lime → violet brand gradient) · `destructive` (red sheen)
- `size`: `xs` (h-8) · `sm` (h-9) · `default` (h-10)
- `htmlType` — passes through to native `type` attribute. Defaults to `button`.

```tsx
<FancyButton intent="primary">Try Open Mercato AI</FancyButton>
<FancyButton intent="neutral" size="sm">Sign up free</FancyButton>
```

### MUST rules

- Use sparingly — one FancyButton per page section at most.
- The `primary` gradient pulls from `--brand-lime` and `--brand-violet`; do NOT swap to other brand pairs.
- For dialog footers, settings pages, data tables → use `Button` not `FancyButton`.

---

## Checkbox / CheckboxField

```typescript
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
```

`Checkbox` is the Radix primitive. `CheckboxField` is the composite for form rows with label, description, sublabel, badge, optional link.

### Sizes

| Size | px | Use case |
|---|---|---|
| `sm` (default) | 16px | DataTable rows, compact lists, dense forms |
| `md` | 20px | Form fields with label, settings pages, opt-in toggles |

### Indeterminate

Set `checked="indeterminate"` to render a horizontal dash. Useful for "select all" headers when only some children are selected.

```tsx
<Checkbox checked={someSelected ? 'indeterminate' : allSelected} onCheckedChange={toggleAll} />
```

### CheckboxField props

| Prop | Purpose |
|---|---|
| `label` (required) | Primary label text — clickable, bound via `htmlFor` |
| `sublabel` | Inline text after the label (smaller, muted) |
| `description` | Helper text on its own line under the label |
| `badge` | Inline badge node (e.g. "NEW" pill) |
| `link` | Optional link/link-button rendered below description |
| `flip` | Render checkbox on the right of the content |
| `size` | Defaults to `md` (20px) for form fields |

```tsx
<CheckboxField label="Send me product updates" checked={value} onCheckedChange={setValue} />

<CheckboxField
  label="Enable two-factor authentication"
  sublabel="(Recommended)"
  description="Adds an extra security step at sign-in using your authenticator app."
  badge={<Tag variant="info">NEW</Tag>}
  link={<LinkButton size="sm" variant="primary">Learn more</LinkButton>}
  checked={twoFa}
  onCheckedChange={setTwoFa}
/>

<CheckboxField flip label="Public profile" checked={isPublic} onCheckedChange={setIsPublic} />
```

### MUST rules

- **NEVER use raw `<input type="checkbox">`** anywhere. Always use `Checkbox`. Native `accent-color: var(--accent-indigo)` is set globally as a safety net for legacy code, but new code MUST use `Checkbox`.
- One source of truth — `apps/mercato/src/components/ui/checkbox.tsx` and `packages/create-app/template/src/components/ui/checkbox.tsx` re-export from `@open-mercato/ui/primitives/checkbox`. Do NOT fork.
- NEVER render `<Checkbox />` next to raw `<label>` — use `CheckboxField`.
- Use `size="md"` for form fields; `size="sm"` for table rows / inline lists.
- For "select all" headers, drive `checked` with the literal string `'indeterminate'` (not boolean) — Radix expects this.

### Color contract

Checkbox checked state uses `--accent-indigo` (#6366f1 light / #818cf8 dark), NOT `--primary`. This matches Figma DS and visually distinguishes selection from primary action surfaces.

---

## Input

```typescript
import { Input } from '@open-mercato/ui/primitives/input'
```

Text input primitive aligned with Figma DS Text Input. Renders a wrapper div with `[border + bg + focus halo + disabled tokens]` around the inner `<input>`. Supports left/right icon slots and standard HTML input types (`text`, `email`, `password`, `number`, `tel`, `url`, `search`, `date`).

> Specialized inputs (Tag Input, Counter Input, Digit/OTP, Inline edit, Date Picker) are SEPARATE primitives — defer to their own sections when they land.

### Sizes

| Size | Height | Padding | Text |
|---|---|---|---|
| `sm` | 32px | `px-2.5` | `text-xs` |
| `default` | 36px | `px-3` | `text-sm` |
| `lg` | 40px | `px-3` | `text-sm` |

Match the size of paired buttons in toolbars / form footers (same-size rule).

### States (token-driven, automatic)

| State | Trigger | Visual |
|---|---|---|
| Default | — | `border-input` + `bg-background` + `shadow-xs` |
| Hover | mouse over wrapper | `bg-muted/40` |
| Focus | input focus-visible | `border-foreground` + `shadow-focus` (Figma 2-ring) |
| Disabled | `disabled` prop on input | `bg-bg-disabled` + `text-text-disabled` + `border-border-disabled` (NOT opacity) |
| Error | `aria-invalid={true}` on input | `border-destructive` (also on focus) |

> Error state uses standard ARIA — wire `aria-invalid={!!error}` from form state. `FormField` wrapper does this automatically.

### Icon slots

```tsx
import { Input } from '@open-mercato/ui/primitives/input'
import { Search, User, AtSign, Lock } from 'lucide-react'

<Input leftIcon={<Search />} placeholder="Search…" />
<Input leftIcon={<AtSign />} type="email" placeholder="you@example.com" />
<Input leftIcon={<Lock />} type="password" />
<Input rightIcon={<User />} placeholder="Username" />
```

Icons render at `size-4` (16px) — matches `text-sm` baseline. Override via wrapping the icon yourself if needed.

### Composition with FormField

```tsx
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

<FormField label="Email" required error={errors.email}>
  <Input
    type="email"
    leftIcon={<AtSign />}
    placeholder="you@example.com"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    aria-invalid={!!errors.email}
  />
</FormField>
```

### Props

| Prop | Default | Notes |
|---|---|---|
| `size` | `default` | `sm` / `default` / `lg` |
| `type` | `text` | Standard HTML — `email`, `password`, `number`, `tel`, `url`, `search`, `date` |
| `leftIcon` / `rightIcon` | — | Lucide icon node |
| `className` | — | Applied to OUTER wrapper (border, radius, padding) — what users typically customize |
| `inputClassName` | — | Applied to INNER `<input>` — for font/color overrides |
| All standard HTML input props | — | `placeholder`, `value`, `onChange`, `disabled`, `required`, `autoComplete`, `aria-invalid`, etc. |

### MUST rules

- **NEVER use raw `<input type="text|email|password|number|tel|url|search">`** anywhere — always use `Input` primitive. Native styles break visual consistency.
- Wire `aria-invalid={!!error}` from form state — the wrapper picks it up via `has-[input[aria-invalid=true]]:border-destructive` selector. No extra className needed.
- For form fields with label/error, wrap with `FormField` — handles label binding (`htmlFor`/`id`), error display, required marker.
- `className` goes to wrapper (where border/radius/padding live). For inner `<input>` overrides use `inputClassName`.
- Same-row sizing rule applies — Input next to Button MUST share `size`.

### Specialized variants (NOT this primitive)

| Variant | Component | Status |
|---|---|---|
| Tag input (multi-tag pill) | `TagInput` | Available — see [TagInput](#taginput) section below |
| Counter (number with +/- buttons) | `CounterInput` | Available — see [CounterInput](#counterinput) section below |
| Digit / OTP code | `DigitInput` | Available — see [DigitInput](#digitinput) section below |
| Inline edit (no border, click-to-edit) | `InlineInput` | Available — see [InlineInput](#inlineinput) section below |
| Date picker | (existing date input components) | Already in `inputs/` folder |
| Combobox / autocomplete | `ComboboxInput` | Already in `inputs/ComboboxInput` |

---

## Textarea

```typescript
import { Textarea } from '@open-mercato/ui/primitives/textarea'
```

Multi-line text input aligned with Figma DS Text Area. Same wrapper styling as `Input` (border-input, shadow-xs, focus shadow halo, token-driven disabled). Supports vertical resize handle and optional character counter.

### States (token-driven)

| State | Visual |
|---|---|
| Default | `border-input` + `bg-background` + `shadow-xs` |
| Hover | `bg-muted/40` |
| Focus | `border-foreground` + `shadow-focus` (Figma 2-ring) |
| Disabled | `bg-bg-disabled` + `border-border-disabled` (NOT opacity) |
| Error | `border-destructive` (auto via `aria-invalid={true}`) |

Default `min-h-[80px]` and `resize-y` (user can drag the bottom-right grabber to grow vertically).

### Character counter

Set `showCount` + `maxLength` to render a `current/max` indicator below the textarea (positioned bottom-right, uppercase, `text-overline`, color shifts to `text-destructive` if overflowing).

```tsx
<Textarea
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  maxLength={200}
  showCount
  placeholder="Describe the issue…"
/>
```

`aria-live="polite"` on the counter so screen readers announce the changing count.

### Composition with FormField

```tsx
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

<FormField label="Description" required error={errors.description}>
  <Textarea
    value={description}
    onChange={(e) => setDescription(e.target.value)}
    maxLength={500}
    showCount
    aria-invalid={!!errors.description}
  />
</FormField>
```

### Props

| Prop | Default | Notes |
|---|---|---|
| `showCount` | `false` | Render `length/maxLength` counter below |
| `wrapperClassName` | — | Applied to outer wrapper when counter visible |
| `className` | — | Applied to the `<textarea>` element |
| All native textarea props | — | `value`, `onChange`, `placeholder`, `disabled`, `required`, `maxLength`, `rows`, etc. |

### MUST rules

- **NEVER use raw `<textarea>`** — always use `Textarea` primitive.
- For form fields with label + error, wrap with `FormField`.
- Keep `min-h-[80px]` default (matches Figma) — only override when a specific design demands it.
- For `showCount`, ALWAYS set `maxLength` — without it, the counter shows just `length` which is less actionable.
- `resize-y` is allowed (user grows vertically); avoid `resize-none` unless layout breaks.

---

## Select

```typescript
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from '@open-mercato/ui/primitives/select'
```

Dropdown / select primitive built on `@radix-ui/react-select` and aligned with Figma DS Select. Same wrapper styling as `Input` (sizes/states/disabled/focus tokens, error via `aria-invalid`). Use this — never raw `<select>`.

> Specialized variants (Compact icon-only, Inline borderless, Combobox-style with search) are SEPARATE primitives — defer (see "Specialized variants" below).

### Sizes (trigger)

| Size | Height | Padding | Text |
|---|---|---|---|
| `sm` | 32px | `px-2.5` | `text-xs` |
| `default` | 36px | `px-3` | `text-sm` |
| `lg` | 40px | `px-3` | `text-sm` |

Match the size of paired buttons / inputs in the same row.

### States (token-driven)

| State | Trigger | Visual |
|---|---|---|
| Default | — | `border-input` + `bg-background` + `shadow-xs` |
| Hover | mouse over trigger | `bg-muted/40` |
| Focus | keyboard focus | `border-foreground` + `shadow-focus` (Figma 2-ring) |
| Open | menu expanded | (Radix manages — same as Focus visually) |
| Disabled | `disabled` prop on `SelectTrigger` | `bg-bg-disabled` + `text-text-disabled` + `border-border-disabled` |
| Error | `aria-invalid={true}` on trigger | `border-destructive` |

### Basic usage

```tsx
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@open-mercato/ui/primitives/select'

<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Choose option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Option A</SelectItem>
    <SelectItem value="b">Option B</SelectItem>
    <SelectItem value="c">Option C</SelectItem>
  </SelectContent>
</Select>
```

### Composition with FormField

```tsx
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'

<FormField label="Country" required error={errors.country}>
  <Select value={country} onValueChange={setCountry}>
    <SelectTrigger>
      <SelectValue placeholder="Select a country" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="pl">Poland</SelectItem>
      <SelectItem value="us">United States</SelectItem>
    </SelectContent>
  </Select>
</FormField>
```

`FormField` injects `id` / `aria-describedby` / `aria-invalid` / `aria-required` / `disabled` automatically (works with Radix Select trigger).

### Groups, separators, labels

```tsx
<SelectContent>
  <SelectGroup>
    <SelectLabel>Europe</SelectLabel>
    <SelectItem value="pl">Poland</SelectItem>
    <SelectItem value="de">Germany</SelectItem>
  </SelectGroup>
  <SelectSeparator />
  <SelectGroup>
    <SelectLabel>North America</SelectLabel>
    <SelectItem value="us">United States</SelectItem>
    <SelectItem value="ca">Canada</SelectItem>
  </SelectGroup>
</SelectContent>
```

### Icons inside items

```tsx
<SelectItem value="pl">
  <Globe /> Poland
</SelectItem>
```

Icons render at `size-4` (16px) by default — matches `text-sm` baseline.

### Props

| Prop | On | Notes |
|---|---|---|
| `value` / `onValueChange` | `Select` | Controlled value (string) |
| `defaultValue` | `Select` | Uncontrolled initial value |
| `disabled` | `Select` or `SelectTrigger` | Whole-select or per-trigger disable |
| `name` | `Select` | Hidden form input name (Radix renders for native form submit) |
| `required` | `Select` | Adds aria-required + form validation |
| `size` | `SelectTrigger` | `sm` / `default` / `lg` |
| `className` | `SelectTrigger` / `SelectContent` / `SelectItem` | Standard Tailwind override |
| `position` | `SelectContent` | `popper` (default — anchored) or `item-aligned` |

### MUST rules

- **NEVER use raw `<select>`** anywhere — always use `Select` primitive. Native dropdowns render with the OS-default styling (no Figma alignment).
- For form fields with label / error, wrap with `FormField` — handles label binding, error display, ARIA wiring.
- Same-row sizing rule applies — Select next to Input/Button MUST share `size`.
- Icons inside `SelectItem`: place before text, let primitive handle spacing.
- For LARGE option lists with search, do NOT cram into `Select` — use `ComboboxInput` from `@open-mercato/ui/backend/inputs/ComboboxInput` instead.

### Specialized variants (NOT this primitive)

| Variant | Component | Status |
|---|---|---|
| Icon-only / compact trigger | `CompactSelect` | TODO — Figma node `377:5083` |
| Inline borderless trigger | `InlineSelect` | TODO — Figma node `332:4537` |
| Compact for input prefix (e.g. country code in phone) | `CompactSelectForInput` | TODO — Figma node `307:16883` |
| Multi-select with search / combobox | `ComboboxInput` | Already in `backend/inputs/ComboboxInput` |
| Date picker | (existing date input components) | Already in `inputs/` folder |

---

## Switch / SwitchField

```typescript
import { Switch } from '@open-mercato/ui/primitives/switch'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
```

Binary on/off toggle aligned with Figma DS Switch. `Switch` is the primitive (track + thumb). `SwitchField` is the preference-row composite (label/description/sublabel/badge/link, switch on the right by default).

### Sizes

Single size — Figma spec is fixed at 28×16 (track), thumb 12px. Matches the row height of `text-sm` body text.

### States (token-driven)

| State | Track | Thumb | Visual |
|---|---|---|---|
| Off Default | `bg-input` (`#ebebeb` light / dark equivalent) | white | flat track |
| Off Hover | `bg-input/70` | white | track darkens |
| On Default | `bg-accent-indigo` (`#6366f1`) | white | thumb at right |
| On Hover | `bg-accent-indigo/85` | white | track darkens |
| Focus | (any state) | — | `shadow-focus` (Figma 2-ring halo) |
| Disabled | (state-specific) | white | `opacity-60`, no hover change |

### Color contract

The "on" state uses `--accent-indigo` (matches `Checkbox` checked state) — NOT `--primary`. This keeps selection controls visually consistent and distinct from primary action surfaces (Buttons).

### Switch usage

```tsx
<Switch checked={enabled} onCheckedChange={setEnabled} />

// Uncontrolled
<Switch defaultChecked />

// Disabled
<Switch checked={enabled} onCheckedChange={setEnabled} disabled />
```

### SwitchField usage

```tsx
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

// Default — label LEFT, switch RIGHT (preference style)
<SwitchField
  label="Email notifications"
  description="Get emails for new comments and mentions."
  checked={emailNotifs}
  onCheckedChange={setEmailNotifs}
/>

// With badge + link
<SwitchField
  label="Beta features"
  sublabel="(Experimental)"
  badge={<Tag variant="info">NEW</Tag>}
  description="Try features before public release. May be unstable."
  link={<LinkButton size="sm" variant="primary">Learn more</LinkButton>}
  checked={beta}
  onCheckedChange={setBeta}
/>

// Flipped — switch LEFT, label RIGHT (rare; use when row reads left-to-right as "[toggle] enable X")
<SwitchField flip label="Public profile" checked={isPublic} onCheckedChange={setIsPublic} />
```

### SwitchField props

| Prop | Default | Notes |
|---|---|---|
| `label` (required) | — | Primary label, clickable, bound via `htmlFor` |
| `sublabel` | — | Inline text after label (smaller, muted) |
| `description` | — | Helper text on its own line under the label |
| `badge` | — | Inline badge node (e.g. NEW pill) |
| `link` | — | Link/link-button rendered below description |
| `flip` | `false` | If true, switch is on LEFT instead of right |
| All `Switch` props | — | `checked`, `defaultChecked`, `onCheckedChange`, `disabled` |

### MUST rules

- **NEVER build a custom toggle button** for on/off prefs — always use `Switch` / `SwitchField`. Native `<input type="checkbox">` styled as toggle is a DS regression.
- For preference rows with label, use `SwitchField` — handles `htmlFor` / accessible naming and the standard "label LEFT, switch RIGHT" layout.
- Switch vs Checkbox decision: **Switch** = immediate effect on a single setting (toggling instantly applies). **Checkbox** = part of a form, needs explicit Save/Apply.
- Color: never override the `on` state to a non-indigo color (breaks visual contract with Checkbox + DS).

---

## Radio / RadioGroup / RadioField

```typescript
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
```

Single-select radio control built on `@radix-ui/react-radio-group` and aligned with Figma DS Radio. Indigo accent matches `Checkbox`/`Switch`. `RadioGroup` is the container (wires keyboard nav across items), `Radio` is the bare primitive, `RadioField` is the composite for form rows with label/description.

### Sizes

Single size — Figma spec is fixed at 20×20 (matches `Checkbox size="md"` and `Switch` row height).

### States (token-driven)

| State | Outer ring | Inner dot |
|---|---|---|
| Off Default | `border-input` (#ebebeb) + `bg-background` | — |
| Off Hover | `border-muted-foreground/40` | — |
| On Default | `border-accent-indigo` + `bg-accent-indigo` | white 8px dot |
| Focus | (any state) | `shadow-focus` (Figma 2-ring halo) |
| Disabled | (state-specific) `opacity-60` | (preserved if checked) |

### Color contract

The "on" state uses `--accent-indigo` (#6366f1) — same as `Checkbox` checked and `Switch` on. Selection controls share one accent across the DS.

### Basic usage (RadioGroup with bare items + custom labels)

```tsx
<RadioGroup value={value} onValueChange={setValue}>
  <label className="flex items-center gap-2">
    <Radio value="a" id="opt-a" />
    <span>Option A</span>
  </label>
  <label className="flex items-center gap-2">
    <Radio value="b" id="opt-b" />
    <span>Option B</span>
  </label>
</RadioGroup>
```

### Composite usage (RadioField — preferred for form rows)

```tsx
<RadioGroup value={mode} onValueChange={setMode}>
  <RadioField value="customer" label="Customer" description="Buyer with active orders." />
  <RadioField value="prospect" label="Prospect" description="Potential customer in evaluation." />
  <RadioField value="archived" label="Archived" disabled description="No longer active." />
</RadioGroup>
```

### RadioField props

| Prop | Default | Notes |
|---|---|---|
| `value` (required) | — | Value emitted to `RadioGroup.onValueChange` |
| `label` (required) | — | Primary label, clickable, bound via `htmlFor` |
| `sublabel` | — | Inline text after label (smaller, muted) |
| `description` | — | Helper text on its own line under the label |
| `badge` | — | Inline badge node (e.g. NEW pill) |
| `link` | — | Link/link-button rendered below description |
| `flip` | `false` | If true, radio is on the RIGHT instead of left |
| All `Radio` props | — | `value`, `disabled`, `id`, `aria-*` |

### MUST rules

- **NEVER use raw `<input type="radio">`** — always use `Radio` (with `RadioGroup`) or `RadioField`.
- **MUST wrap radios in `RadioGroup`** — Radix needs the group context for keyboard nav (Arrow keys move focus AND selection between radios).
- For form rows with label + description, use `RadioField` — handles `htmlFor` binding and consistent layout.
- Color: never override the `on` state to a non-indigo color (breaks visual contract with Checkbox + Switch).
- Radio vs Checkbox vs Switch: **Radio** = mutually exclusive choice (one of N). **Checkbox** = independent selection (multiple OK). **Switch** = immediate-effect single setting.

---

## Tooltip / SimpleTooltip

```typescript
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  SimpleTooltip,
} from '@open-mercato/ui/primitives/tooltip'
```

Hover/focus tooltip built on `@radix-ui/react-tooltip`. `SimpleTooltip` is the convenience wrapper for the 95% case. Drop-in primitives `Tooltip` / `TooltipTrigger` / `TooltipContent` for advanced control.

> Mount `<TooltipProvider>` once near the app root (already done in backend shells) so tooltips share `delayDuration` / animation context.

### Variants

| Variant | Visual | Use case |
|---|---|---|
| `dark` (default) | `bg-foreground` + light text | **Default** — high contrast, works on light surfaces. `arrow` enabled by default |
| `light` | `bg-popover` + dark text + 1px border | Use over dark surfaces or when you want the tooltip to blend with the page (set `arrow` explicitly if needed) |

### Sizes

| Size | Padding / text | Use case |
|---|---|---|
| `sm` | `px-1.5 py-0.5` / 12/16 | Compact triggers (icon buttons, table cells) |
| `default` | `px-2 py-1` / 12/16 | Most cases |
| `lg` | `px-3 py-2` / 14/20 | Multi-line / rich content |

### Arrow

Set `arrow` prop to render a small triangle pointing at the trigger (Radix renders + auto-rotates per side).

### Basic usage (SimpleTooltip)

```tsx
<SimpleTooltip content="Full text shown on hover">
  <span className="truncate">{shortText}</span>
</SimpleTooltip>

// Light variant + arrow
<SimpleTooltip content="Helps explain this control" variant="light" arrow>
  <IconButton variant="ghost" size="sm" type="button" aria-label="Help">
    <HelpCircle className="size-4" />
  </IconButton>
</SimpleTooltip>

// Multi-line / rich content
<SimpleTooltip
  content={<><strong>Pro tip:</strong> hold Shift to multi-select</>}
  size="lg"
  side="bottom"
  align="start"
>
  <InfoIcon className="size-4" />
</SimpleTooltip>
```

### Advanced (composed)

```tsx
<Tooltip delayDuration={500}>
  <TooltipTrigger asChild>
    <Button>Hover me</Button>
  </TooltipTrigger>
  <TooltipContent variant="light" arrow side="right">
    Cross-platform shortcut: <KbdShortcut keys={['⌘', 'K']} />
  </TooltipContent>
</Tooltip>
```

### MUST rules

- **Wrap the trigger with `asChild`** when the trigger is your own component (Button, IconButton) — Radix needs to forward refs/event handlers onto the actual DOM node.
- **NEVER use raw `title` attribute** for non-trivial hints — `title` has no styling, no positioning, no a11y for keyboard. Use `Tooltip`.
- For TRUNCATED text indicators, use `SimpleTooltip` to surface the full text on hover (already pattern in DataTable cells via `TruncatedCell`).
- For HELP icons next to form labels, prefer `variant="light"` + `arrow` — better contrast on dialogs / cards.
- Default `delayDuration={300}` — keep this unless you need slower (e.g. for accidental hovers in dense lists, set `500`).
- For mobile / touch — Radix opens tooltips on long-press; do NOT rely on tooltip for critical info, repeat the same in label / placeholder when possible.

---

## Avatar / AvatarStack

```typescript
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
```

| Size | px | Use case |
|---|---|---|
| `sm` | 24px | Table rows, AvatarStack, inline lists |
| `default` | 32px | Sidebar, comments, activity feed |
| `md` | 40px | Section headers, assignee cards |
| `lg` | 80px | Profile / detail page header |

```tsx
<Avatar name="Jan Kowalski" />        // → "JK"
<Avatar name="Copperleaf Design" />   // → "CD"

<AvatarStack max={3}>
  <Avatar name="Jan Kowalski" size="sm" />
  <Avatar name="Oliwia Z." size="sm" />
  <Avatar name="Anna Nowak" size="sm" />
  <Avatar name="Sarah Mitchell" size="sm" />
</AvatarStack>
// renders: JK · OZ · AN · +1
```

### MUST rules

- NEVER render `<div className="rounded-full bg-muted ...">` for avatars — use `Avatar`.
- NEVER add photo/image support — Avatar is initials-only by design.
- `size="sm"` uses `text-[9px]` — DS exception for tiny initials.
- `ring-2 ring-background` is built-in — provides border for `AvatarStack` overlap.
- For unknown users / empty states: render `<Avatar />` (blank muted circle).

---

## Kbd / KbdShortcut

```typescript
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
```

```tsx
<Kbd>Esc</Kbd>
<Kbd>⌘</Kbd>
<KbdShortcut keys={['⌘', 'Enter']} />   // ⌘ + Enter
<KbdShortcut keys={['Ctrl', 'S']} />

<span className="text-xs text-muted-foreground">
  Press <KbdShortcut keys={['⌘', 'Enter']} /> to save or <Kbd>Esc</Kbd> to cancel
</span>
```

### MUST rules

- NEVER use raw `<span>` or `<code>` to display keyboard keys — use `Kbd`.
- Platform-specific keys (`⌘` vs `Ctrl`): detect with `navigator.platform` or use `Ctrl/⌘` text.

---

## Tag

```typescript
import { Tag, type TagMap } from '@open-mercato/ui/primitives/tag'
```

Static pill for user-applied label on an entity (e.g. "Customer", "Hot", "Renewal"). For SYSTEM status (active, pending, failed), use `StatusBadge`.

| | `Tag` | `StatusBadge` |
|---|---|---|
| Purpose | User-applied label / category | System status |
| `brand` variant | ✅ (violet — for custom views/renewal tags) | ❌ |

| Variant | Token | Example |
|---|---|---|
| `default` | `border-border bg-background text-muted-foreground` | Generic / inactive |
| `success` | `status-success-*` | Customer, Shipped, Active |
| `warning` | `status-warning-*` | Renewal, At risk |
| `error` | `status-error-*` | Hot, Overdue, Blocked |
| `info` | `status-info-*` | Pending, In review |
| `neutral` | `status-neutral-*` | Archived, Draft |
| `brand` | `brand-violet` family | Custom views, Perspectives |

```tsx
<Tag variant="success" dot>Customer</Tag>
<Tag variant="error" dot>Hot</Tag>
<Tag variant="brand" dot>Renewal Q1 2026</Tag>
<Tag variant="neutral">Inactive</Tag>

const leadTagMap: TagMap<'customer' | 'hot' | 'inactive' | 'renewal'> = {
  customer: 'success',
  hot: 'error',
  inactive: 'neutral',
  renewal: 'brand',
}
<Tag variant={leadTagMap[tag.type]} dot>{tag.label}</Tag>
```

### Shape

| Shape | Token | Use case |
|---|---|---|
| `pill` (default) | `rounded-full px-2.5 py-0.5` | Status/category tag (Customer, Hot, Renewal) |
| `square` | `rounded-md px-2 py-1` | Removable chips inside inputs (`TagInput`, `TagsInput`) |

### Removable chips

`onRemove` renders an inline close (×) button using Lucide `X`. The button calls `event.stopPropagation()` before invoking `onRemove`, so clicking × does not trigger the chip's own click. Always pass `removeAriaLabel` translated via `useT()`.

```tsx
const t = useT()
<Tag
  shape="square"
  variant="default"
  disabled={isLocked}
  onRemove={() => removeTag(tag)}
  removeAriaLabel={t('mymodule.tags.remove', 'Remove {label}', { label })}
>
  {label}
</Tag>
```

### MUST rules

- NEVER hardcode colors on `Tag` — use variants only.
- Use `dot` for status-like categories (Customer, Hot); omit for purely descriptive labels.
- For "Manage tags" / add-tag affordances: use `Button variant="ghost"` or dashed outline — NOT `Tag`.
- `brand` variant is for user-saved views and renewal/custom category tags only.
- Use `shape="square"` for chips inside text inputs/combobox/`TagsInput`; keep `shape="pill"` (default) for standalone status/category tags.
- When passing `onRemove`, MUST also pass `removeAriaLabel` translated via `useT()` — the primitive default `'Remove'` is English-only.

---

## TagInput

```typescript
import { TagInput } from '@open-mercato/ui/primitives/tag-input'
```

Two-row primitive (input on top, chips below) for collecting a flat list of free-form tags. Built on `Input` + `Tag shape="square"`. Use when the user types comma/separator-delimited values and the result is `string[]`. For value-from-suggestions (autocomplete with descriptions, async loaders), use `TagsInput` from `@open-mercato/ui/backend/inputs/TagsInput` instead.

### Sizes

| Size | Token | Figma |
|---|---|---|
| `sm` | `h-8` (32px) | `428:4860` sm |
| `default` | `h-9` (36px) | `428:4860` default |
| `lg` | `h-10` (40px) | `428:4860` lg |

### Behaviors

- **Enter** — commits current input as a tag.
- **Separator paste** — pasting `'a,b,c'` (or matching `separator`) splits into multiple tags; trailing remainder stays in the input.
- **Backspace on empty input** — removes the last tag.
- **Click ×** on chip — removes that tag.
- **`maxTags` reached** — input becomes `disabled`; further typing is blocked.
- **`validate`** — `(tag) => true | false | string`. Return `false` to silently reject; return a string to surface as inline error.

### Usage

```tsx
const t = useT()
const [tags, setTags] = React.useState<string[]>([])

<TagInput
  value={tags}
  onChange={setTags}
  placeholder={t('mymodule.tags.placeholder', 'Add tag, press Enter')}
  size="default"
  maxTags={10}
  separator={/[,\s]/}
  validate={(tag) => tag.length <= 32 || t('mymodule.tags.tooLong', 'Max 32 chars')}
/>
```

### MUST rules

- NEVER hand-roll `<input> + <span>` chip rows — use `TagInput` (free-form) or `TagsInput` (with suggestions/labels).
- Pass `placeholder` translated via `useT()` — primitive has no built-in i18n.
- For value+label+description triples (where `value !== label`), use `TagsInput`, not `TagInput`. `TagInput` deliberately keeps the data shape flat (`string[]`).

---

## CounterInput

```typescript
import { CounterInput } from '@open-mercato/ui/primitives/counter-input'
```

Stepper primitive for entering an integer or decimal number with `−` / `+` buttons on each side. Built on a flex wrapper with two icon-only buttons and a centered native `<input type="number">`. Use whenever the value is a small bounded count (quantity in a cart, return qty per line, page size selector, retry count). For free-form numbers without min/max, prefer `<Input type="number">` directly.

### Sizes

| Size | Height | Figma | Use case |
|---|---|---|---|
| `sm` | h-8 (32px) | X-Small (32) | Dense table cells, inline qty selectors |
| `default` | h-9 (36px) | Small (36) | Default |
| `lg` | h-10 (40px) | Medium (40) | Form rows alongside `Input lg` / `Select` etc. |

### Behaviors

- **`+` / `−` buttons** — adjust value by `step` (default `1`). Clamped to `min` / `max`.
- **Direct typing** — text typed in the input is parsed, clamped, and emitted on each change. Empty input emits `null`.
- **Keyboard** — ArrowUp / ArrowDown step by `step` (preventDefault to avoid native browser increment).
- **Disabled at boundary** — the `+` button is disabled when value === `max`; the `−` button is disabled when value === `min`. Both are disabled when the `disabled` prop is set.
- **Precision** — `precision={n}` formats the displayed value to `n` decimals (default `0`). Useful for currency-adjacent fields.
- **Native spinner arrows hidden** — `[appearance:textfield]` + the webkit override hide the browser's own spinner buttons so the primitive owns the increment UX.

### Usage

```tsx
const [qty, setQty] = React.useState<number | null>(1)
const t = useT()

<CounterInput
  value={qty}
  onChange={setQty}
  min={1}
  max={available}
  step={1}
  decrementAriaLabel={t('cart.qty.decrease', 'Decrease quantity')}
  incrementAriaLabel={t('cart.qty.increase', 'Increase quantity')}
/>
```

For an error state, pass `aria-invalid` — the wrapper border switches to `border-destructive`.

### MUST rules

- NEVER hand-roll `<Input type="number">` + plus/minus buttons — use `CounterInput`.
- Pass `decrementAriaLabel` / `incrementAriaLabel` translated via `useT()` — primitive defaults `Decrease` / `Increase` are English.
- For free-form numbers without bounded `min`/`max` (e.g. unit price, percentage, free-text amount), prefer `<Input type="number">` directly — `CounterInput` is for **stepper** UX (small bounded counts).
- Always pass both `min` and a sensible `max` when a `+` button would otherwise grow the value unbounded — the primitive enforces clamping, but the disabled state on the buttons only kicks in when bounds are known.

---

## DigitInput

```typescript
import { DigitInput } from '@open-mercato/ui/primitives/digit-input'
```

`length`-cell verification code input for OTP / 2FA / PIN entry flows. Renders `length` separate `<input maxLength={1}>` boxes side by side. Auto-focuses the next cell on type, the previous cell on Backspace from an empty cell. Paste distributes the clipboard string across cells and fires `onComplete` when all cells fill.

The `value` prop is the assembled string (`'123456'`), not a tuple — cells are an internal layout concern.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` / `onChange` | `string` / `(value) => void` | uncontrolled | Assembled value. `onChange` fires on every char/paste. |
| `length` | `number` | `6` | Number of cells. |
| `inputMode` | `'numeric' \| 'text'` | `'numeric'` | `numeric` filters out non-digits both for typing and paste. `text` accepts any character. |
| `mask` | `boolean` | `false` | Renders each cell as `type='password'` so characters display as bullets. Consumers still receive the raw characters in `onChange` / `onComplete`. |
| `autoFocus` | `boolean` | `false` | Auto-focuses the first cell on mount. |
| `disabled` | `boolean` | `false` | Disables all cells. |
| `onComplete` | `(value) => void` | — | Fires when the assembled value reaches `length`. |
| `aria-label` | `string` | `Verification code` | Applied to the group wrapper. Each cell gets `<aria-label> digit N`. |
| `aria-invalid` | `boolean` | — | Propagates to the wrapper and every cell — triggers the destructive border. |
| `id` / `name` | `string` | — | Forwarded to the **first** cell only so consumers can label the whole group via `<label htmlFor>` and so form submissions carry the assembled value. |
| `className` / `cellClassName` | `string` | — | Override wrapper / individual cell classes. |

### Usage

```tsx
const t = useT()
const [code, setCode] = React.useState('')

<DigitInput
  value={code}
  onChange={setCode}
  onComplete={(filled) => verifyCode(filled)}
  length={6}
  autoFocus
  aria-label={t('auth.twoFactor.code', 'Two-factor code')}
/>
```

### Keyboard contract

- **Type a digit** — commits the value and focuses the next cell.
- **Backspace on an empty cell** — focuses the previous cell and clears its value.
- **Backspace on a filled cell** — clears the current cell (native input behaviour).
- **ArrowLeft / ArrowRight** — navigate between cells without mutating values.
- **Paste** — splits the clipboard text into cells (filtered by `inputMode`) and fires `onComplete` if the resulting string reaches `length`.

### MUST rules

- NEVER hand-roll a row of `<input maxLength={1}>` cells with manual `useRef` arrays — use `DigitInput`.
- Pass `aria-label` translated via `useT()` so the group label and the per-cell labels are localized.
- Use `inputMode="text"` only when the verification code includes letters — keep the default `numeric` for OTPs (it triggers the mobile number pad and rejects accidental keystrokes from password managers).
- `mask=true` swaps `type='text'` for `type='password'` to hide the digits visually. Combine with `autoComplete="one-time-code"` (already on by default) to stay aligned with native OTP autofill flows.

---

## CompactSelect

```typescript
import {
  CompactSelectTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectValue,
} from '@open-mercato/ui/primitives/compact-select'
```

Toolbar-density variant of the `Select` trigger — the trigger renders at the new `Select` `size="xs"` (h-7 / 28px / px-2 / text-xs) while the `Select` root, content, and items stay identical. Use when a Select sits in a toolbar / pagination footer / DataTable settings cluster next to icon buttons that are h-7 themselves. Anywhere a full h-9 `Select` would dwarf the surrounding row.

### When NOT to use

- For form rows next to `<Input>` / `<DatePicker>` / regular buttons — use the regular `Select size="default"` (h-9) so heights match.
- For dense filter chips that need a wholly different popover UX — use `FilterOverlay` or `DropdownMenu` instead.

### `triggerLabel` prefix

Render an inline muted prefix before the selected value (e.g. `View:` / `Sort by:` / `Period:`). Slot is omitted when not provided.

```tsx
const t = useT()
<Select value={view} onValueChange={setView}>
  <CompactSelectTrigger
    triggerLabel={t('dashboards.view.label', 'View:')}
    aria-label={t('dashboards.view.aria', 'Switch dashboard view')}
  >
    <SelectValue />
  </CompactSelectTrigger>
  <SelectContent>
    <SelectItem value="grid">{t('dashboards.view.grid', 'Grid')}</SelectItem>
    <SelectItem value="list">{t('dashboards.view.list', 'List')}</SelectItem>
  </SelectContent>
</Select>
```

### MUST rules

- NEVER hand-roll `<SelectTrigger size="sm" className="h-7">` — use `CompactSelectTrigger`. The xs (h-7) size is reserved for `CompactSelect`.
- Pair with the regular `Select` root + `SelectContent` / `SelectItem`. The primitive only customizes the trigger; the content/items intentionally share Radix instances with the regular `Select`.
- Pass `triggerLabel` through `useT()` and add `aria-label` to the trigger — the prefix label is visual, not announced by screen readers (it lives inside the trigger button alongside the value).

---

## InlineInput

```typescript
import { InlineInput } from '@open-mercato/ui/primitives/inline-input'
```

Borderless variant of `Input` for click-to-edit cells, key/value renamers, kanban card titles, and other inline editing UI where a fully bordered field would look heavy. At rest the input renders as plain text (transparent border, transparent background, no shadow). On hover a subtle border + muted background reveals the affordance; on focus the standard `border-foreground` + focus shadow inherited from the underlying `Input` wrapper takes over for accessibility.

### Sizes

| Size | Height | Use case |
|---|---|---|
| `sm` (default) | h-8 (32px) | Dense rows, kanban titles, JSON key renamers |
| `default` | h-9 (36px) | Inline editors that sit next to h-9 controls (Buttons, Selects) |

### Behaviors

- **At rest** — transparent border + transparent bg + no shadow. Looks like plain text aligned to the surrounding row.
- **Hover** — `border-input` + `bg-muted/40` (when `showBorderOnHover={true}`, the default). Skipped when `false`.
- **Focus** — inherits `Input` wrapper's `focus-within:border-foreground` + `focus-within:shadow-focus`. Always shown for keyboard a11y.
- **`onBlur`** — fully forwarded. Consumers wire it for the typical "save on blur" pattern.
- **All `Input` props** — `value`, `onChange`, `placeholder`, `type`, `leftIcon`, `rightIcon`, `inputClassName`, `aria-invalid`, etc. — flow through unchanged.

### Usage

```tsx
const t = useT()
const [draft, setDraft] = React.useState(value)

<InlineInput
  value={draft}
  onChange={(event) => setDraft(event.target.value)}
  onBlur={() => onSave(draft)}
  placeholder={t('mymodule.field.placeholder', 'Edit title')}
/>

// Borderless-on-rest, no hover affordance (read-only-looking cells):
<InlineInput
  showBorderOnHover={false}
  value={value}
  onChange={onChange}
  onBlur={onSave}
/>
```

### MUST rules

- NEVER hand-roll `<input className="border-transparent hover:border-input ...">` — use `InlineInput`.
- For high-level "click-to-edit with save / cancel buttons + validation" UX, use the `InlineTextEditor` from `@open-mercato/ui/backend/detail/InlineEditors` instead. `InlineInput` is the **low-level** atom — consumers wire the save / cancel state machine themselves.
- Pass `placeholder` translated via `useT()`. The primitive has no built-in i18n (matches `Input`).
- Use `showBorderOnHover={false}` only when the field is decorative or part of a much larger interactive surface — the hover border is the discoverability hint that the field is editable.

---

## InlineSelect

```typescript
import {
  InlineSelectTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectValue,
} from '@open-mercato/ui/primitives/inline-select'
```

Borderless variant of `SelectTrigger` — the select-typed counterpart to `InlineInput`. At rest the trigger renders as plain text (transparent border, transparent background, no shadow); on hover a subtle border + muted bg reveals the affordance, on focus the standard `border-foreground` + focus shadow inherited from the underlying `SelectTrigger` takes over for accessibility. Pair with the regular `Select` root + `SelectContent` / `SelectItem`; the composition only customizes the trigger.

### Sizes

| Size | Height | Use case |
|---|---|---|
| `sm` (default) | h-8 (32px) | Dense rows, kanban card stage selectors, detail cards |
| `default` | h-9 (36px) | Inline selectors next to h-9 controls |

### When NOT to use

- For high-level "click-to-edit with save / cancel + draft state" UX, use `InlineSelectEditor` from `@open-mercato/ui/backend/detail/InlineEditors`. `InlineSelectTrigger` is the **low-level atom** — consumers wire their own state machine (the trigger is always live, no display-vs-edit boundary).
- For toolbar-density dropdowns (DataTable pagination, dashboard widget settings), use `CompactSelectTrigger` instead — that one is h-7 toolbar density, not borderless.

### Usage

```tsx
const t = useT()
const [stage, setStage] = React.useState<string>(initialStage)

<Select value={stage} onValueChange={(next) => { setStage(next); persist(next) }}>
  <InlineSelectTrigger aria-label={t('deals.stage.aria', 'Deal stage')}>
    <SelectValue />
  </InlineSelectTrigger>
  <SelectContent>
    {stages.map((option) => (
      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
    ))}
  </SelectContent>
</Select>

// Borderless-on-rest, no hover affordance (heavily contextual surfaces):
<Select value={value} onValueChange={onChange}>
  <InlineSelectTrigger showBorderOnHover={false} aria-label="Quick filter">
    <SelectValue />
  </InlineSelectTrigger>
  ...
</Select>
```

### MUST rules

- NEVER hand-roll `<SelectTrigger className="border-transparent hover:border-input ...">` — use `InlineSelectTrigger`.
- Pair with the regular `Select` root + `SelectContent` / `SelectItem`. The primitive only customizes the trigger.
- Always pass `aria-label` to the trigger — `InlineSelectTrigger` renders as plain text at rest, so screen-reader users rely on the explicit label rather than visual chrome.
- Use `showBorderOnHover={false}` only when the trigger sits inside a larger interactive surface that already signals editability — the hover border is the default discoverability cue.

---

## TimePicker

```typescript
import {
  TimePicker,
  TimePickerSlot,
  TimePickerDurationChip,
  TimePickerStatusChip,
  HorizontalScrollRow,
  formatDuration,
  formatTimePickerDisplay,
  type TimePickerValue,
  type TimePickerStatusVariant,
} from '@open-mercato/ui/primitives/time-picker'
```

Compound primitive per Figma `164611:83414`: a popover/inline card with optional header (current value), optional duration chip row, optional status chip row, scrollable slot list (12h/24h), pinned-top quick actions (e.g. "Now"), and footer with Cancel/Apply. Built on Lucide icons + `Popover` + `Button`.

For free-form "HH:MM" trigger UX without slots/durations, use the legacy `backend/inputs/TimePicker` shim — it wraps this primitive with `headerPlaceholder`/`Now`/`Clear` already wired through `useT()`.

### Atoms

| Atom | Purpose | Key props |
|---|---|---|
| `TimePickerSlot` | Single time row (e.g. `01:30 PM`) | `value`, `selected`, `disabled`, `rightText`, `format='12h'\|'24h'`, `onSelect` |
| `TimePickerDurationChip` | Round chip showing a duration (e.g. `30 min` / `1h 30m`) | `value`, `label?`, `selected`, `disabled`, `onSelect` |
| `TimePickerStatusChip` | Coloured dot + label (`Available` / `Busy` / `In meeting` / `Offline`) | `variant`, `label?`, `selected`, `disabled`, `onSelect` |
| `HorizontalScrollRow` | Horizontally-scrollable row with chevron arrows that appear on overflow | `children`, `ariaLabel`, `scrollLeftAriaLabel`, `scrollRightAriaLabel`, `arrowSize` |

`HorizontalScrollRow` is exported standalone — use it whenever a row of chips needs the same scroll/fade/arrow UX (e.g. inline duration row inside a meeting form).

### Composition

```tsx
<TimePicker
  value={value}
  onChange={setValue}
  slots={['09:00', '09:30', '10:00', '10:30', '11:00']}
  durations={[{ value: 30 }, { value: 60 }, { value: 90 }]}
  activeDuration={30}
  onDurationChange={setDuration}
  trigger={<Button variant="outline">{formatTimePickerDisplay(value, '12h').main}</Button>}
/>
```

Common options:

- `headerPlaceholder` — header text when value is null (default: `t('ui.timePicker.placeholder', 'Pick a time')`)
- `cancelLabel` / `applyLabel` — footer button labels (default: `useT('ui.timePicker.cancelButton'|'applyButton')`)
- `statusLabel` — caption above the status chip row (default: `useT('ui.timePicker.statusLabel')`)
- `pinnedTopActions` — sticky quick-action rows above the slot list (used for legacy "Now")
- `legacyFooterActions` — link-style buttons rendered to the LEFT of Cancel/Apply
- `format: '12h' | '24h'` — default `'12h'`
- `trigger` — wraps the card in `Popover`; without it the card renders inline

### i18n keys (built-in defaults)

| Key | Default | Used for |
|---|---|---|
| `ui.timePicker.placeholder` | `Pick a time` | Header when value is null |
| `ui.timePicker.label` | `Time picker` | Dialog aria-label |
| `ui.timePicker.closeButton` | `Close` | Close (×) button aria-label |
| `ui.timePicker.cancelButton` | `Cancel` | Footer cancel |
| `ui.timePicker.applyButton` | `Apply` | Footer apply |
| `ui.timePicker.statusLabel` | `Select status` | Caption above status row |
| `ui.timePicker.durationsRowLabel` | `Quick duration` | aria-label of the duration row |
| `ui.timePicker.scrollLeft` / `.scrollRight` | `Scroll left` / `Scroll right` | HorizontalScrollRow chevrons |

### Helpers

- `formatTimePickerDisplay(value, format)` returns `{ main, suffix }` for the trigger/header (e.g. `{ main: '01:30', suffix: 'PM' }`).
- `formatDuration(minutes, options?)` — English-only utility. Returns strings like `'15 min'`, `'1 hour'`, `'1h 30m'`. **Do not call directly in user-facing UI** — instead, build a translatable lookup table per consumer (see `customers/components/detail/schedule/DateTimeFields.tsx` for the canonical pattern).

### MUST rules

- NEVER hand-roll a time-of-day input — use `TimePicker` (slots/duration/status workflow) or the legacy `backend/inputs/TimePicker` shim (free-form HH:MM trigger).
- For a row of duration chips in a custom form layout, use `<HorizontalScrollRow>` to get the same scrollbar-less + fade-gradient + chevron UX as the composition.
- When passing custom `cancelLabel` / `applyLabel` / `statusLabel` / `headerPlaceholder`, route them through `useT()` — primitive defaults are English.
- `formatDuration` is English-only — for translatable labels, define a lookup map keyed on the integer minutes value, with `t(key, fallback)` resolution inside the consumer.
- Active state for slot / duration / status uses `bg-brand-violet/10 text-brand-violet`, NOT `bg-primary/10` — `--primary` in this codebase is near-black; `--brand-violet` is the actual violet.

---

## Alert

```typescript
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
```

Unified component for inline contextual messages, floating notifications, and toast feedback. Per the Figma `169:2358` guidelines, **Alert / Notification / Toast share the same primitive** — only their layout, lifetime, and consumer wrapper differ. Use the props matrix below to dial in the right look for the surface.

### Status (5)

| Status | Default icon | Token family (Figma `state/{x}/*`) | Use case |
|---|---|---|---|
| `information` (default) | `Info` | `status-info-*` (Figma `state/information/*`) | Neutral / informational state |
| `success` | `CheckCircle2` | `status-success-*` (Figma `state/success/*`) | Completed action, saved state |
| `warning` | `AlertTriangle` | `status-warning-*` (Figma `state/warning/*`) | Heads-up that needs attention |
| `error` | `AlertCircle` | `status-error-*` (Figma `state/error/*`) | Failed action, blocking validation |
| `feature` | `Rocket` | `status-neutral-*` (Figma `state/faded/*` — **neutral gray, not brand-violet**) | New release / changelog teaser |

### Style (4)

Tokens map to the Figma `state/{x}/*` variable family — `status-{x}-icon` ↔ Figma `state/{x}/base` (saturated, e.g. `#dc2626`), `status-{x}-border` ↔ Figma `state/{x}/light` (medium tint, e.g. `#fecaca`), `status-{x}-bg` ↔ Figma `state/{x}/lighter` (very light tint, e.g. `#fef2f2`). The `feature` status uses the `status-neutral-*` family because Figma maps it to `state/faded/*` gray, **not** brand-violet.

| Style | Description | Outer wrapper | Icon |
|---|---|---|---|
| `light` (default) | Saturated tinted bg, status-colored text, no border | `bg-status-{x}-border text-status-{x}-text border-transparent` | Rounded badge with `bg-status-{x}-icon` + white icon |
| `lighter` | Very light tinted bg, status-colored text, no border | `bg-status-{x}-bg text-status-{x}-text border-transparent` | Rounded badge with `bg-status-{x}-icon` + white icon |
| `stroke` | White bg, neutral text, soft border + drop shadow | `bg-background text-foreground border-border shadow-lg` | Rounded badge with `bg-status-{x}-icon` + white icon |
| `filled` | Saturated bg, white text | `bg-status-{x}-icon text-white border-transparent` | Plain white icon (no badge wrap) |

`feature` status maps to `--brand-violet` tokens instead of `--status-*` because there is no dedicated `feature` token set in `globals.css`.

### Size (3)

| Size | Layout | Use case |
|---|---|---|
| `sm` (default) | `min-h-9 rounded-md px-3 py-2 text-xs` + `size-4` icon | Toast / inline strip. Grows vertically when content wraps (`min-h-*`). |
| `xs` | `min-h-8 rounded-md px-3 py-1 text-xs` + `size-4` icon | Dense table inline notice. |
| `default` | `rounded-lg px-4 py-3 text-sm` + `size-5` icon | Full inline alert with `AlertTitle` + `AlertDescription` paragraphs. No min height — content drives layout. |

### Usage

```tsx
const t = useT()

// Default inline alert (info, light, default size)
<Alert>
  <AlertTitle>{t('signup.almostThere', 'Almost there')}</AlertTitle>
  <AlertDescription>{t('signup.verifyEmail', 'Check your inbox for the verification link.')}</AlertDescription>
</Alert>

// Saturated success toast with explicit dismiss + action
<Alert
  status="success"
  style="filled"
  size="sm"
  dismissible
  onDismiss={() => closeToast(id)}
  dismissAriaLabel={t('common.dismiss', 'Dismiss')}
  action={<LinkButton onClick={undo}>{t('common.undo', 'Undo')}</LinkButton>}
>
  {t('sales.order.created', 'Order created')}
</Alert>

// Feature announcement with custom icon override
<Alert status="feature" icon={<Sparkles aria-hidden="true" />}>
  <AlertTitle>{t('release.newCheckout', 'New checkout experience')}</AlertTitle>
  <AlertDescription>{t('release.newCheckoutBody', '…')}</AlertDescription>
</Alert>
```

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `status` | `'information' \| 'success' \| 'warning' \| 'error' \| 'feature'` | `'information'` | One of the 5 statuses. |
| `style` | `'light' \| 'lighter' \| 'stroke' \| 'filled'` | `'light'` | Visual emphasis. `'light'` is the safe default (saturated tinted bg using the Figma `state/{x}/light` family — `#fecaca` for error etc.). `'lighter'` uses the very light `state/{x}/lighter` tint. `'stroke'` is the white-bg + drop-shadow variant. `'filled'` is the saturated-bg + white-text variant. |
| `size` | `'sm' \| 'xs' \| 'default'` | `'sm'` | Layout density. `'sm'` uses `min-h-9` so multi-line content still grows the alert vertically. |
| `showIcon` | `boolean` | `true` | Toggle the leading icon. |
| `icon` | `ReactNode` | status default | Override the leading icon (`feature` is the typical case — pass a custom Lucide icon). |
| `dismissible` | `boolean` | `false` | Render a trailing `X` close button. |
| `onDismiss` | `() => void` | — | Fired when the close button is clicked. |
| `dismissAriaLabel` | `string` | `'Dismiss'` | i18n hook for the close button. |
| `action` | `ReactNode` | — | Inline action slot rendered to the right of the body (link buttons typical). |
| `variant` | `'default' \| 'destructive' \| 'success' \| 'warning' \| 'info'` | — | **Deprecated.** BC alias for the pre-Figma-169:2358 API. Maps to `status` and picks up the new `light` + `sm` defaults — visually matches the pre-Figma `light` look (tinted bg with border) at the new `min-h-9` density (which still grows for multi-line content). Prefer `status` in new code. |

### MUST rules

- NEVER hand-roll a tinted `<div role="alert">` — use `Alert`. The five status × four style matrix covers every contextual-message look in the Figma guidelines.
- Use the `light` + `sm` defaults for inline alerts, toasts (FlashMessages already wires them via `flash()`), and notifications — `light` maps to the Figma `state/{x}/light` tokens (`#fecaca` saturated pink for error etc.) and the rounded icon badge gives every status a recognizable badge mark.
- Step up to `size="default"` whenever the message wraps to multiple lines or carries an `AlertTitle` + `AlertDescription` paragraph — `default` has no min-height, larger padding, and uses `rounded-xl` per the Figma Large size.
- Drop to `style="lighter"` for the lowest-emphasis tint (`state/{x}/lighter` — `#fef2f2` for error) when the surface is already crowded.
- Use `style="stroke"` (white bg + soft border + drop shadow + neutral text + icon badge) for floating cards where the alert should sit visually on top of arbitrary page content without taking on a tint.
- Reserve `style="filled"` for explicit high-contrast call-outs where the message must dominate the surrounding chrome — `filled` drops the icon badge in favor of a plain icon over the saturated background.
- The `feature` status renders with the `state/faded/*` gray (Figma palette name) → `status-neutral-*` tokens in code. Do **not** map it to `brand-violet`; that mismatch happened during early iteration and Figma keeps `feature` neutral on purpose so it does not collide with the product's brand color elsewhere.
- Pass `dismissAriaLabel` translated via `useT()` — the primitive default `'Dismiss'` is English-only.
- For ephemeral "save on action" feedback, prefer the global `flash()` helper from `@open-mercato/ui/backend/FlashMessages` (it wraps `Alert` internally) over building your own toast queue.
- The legacy `variant` prop is **deprecated** but still honored — new code should use the explicit `status` + `style` props. Existing call sites continue to work; their look softens slightly (bg `/50`, no border) because the default style is now `lighter` instead of `light`.

---

## Common patterns

```tsx
// Sidebar / nav toggle
<IconButton variant="outline" size="sm" type="button" onClick={toggle} aria-label="Toggle sidebar">
  <PanelLeft className="size-4" />
</IconButton>

// Close / dismiss button
<IconButton variant="ghost" size="sm" type="button" onClick={onClose} aria-label="Close">
  <X className="size-4" />
</IconButton>

// Tab navigation (underline style)
<Button
  type="button"
  variant="ghost"
  size="sm"
  className={cn(
    'h-auto rounded-none border-b-2 px-0 py-1 hover:bg-transparent',
    isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
  )}
>
  {label}
</Button>

// Dropdown menu item
<Button variant="ghost" size="sm" type="button" className="w-full justify-start" role="menuitem">
  <Icon className="size-4" /> {label}
</Button>

// Compact toolbar button (rich text editor)
<Button variant="ghost" size="sm" type="button" className="h-auto px-2 py-0.5 text-xs">
  Bold
</Button>

// Collapsible section header
<Button variant="muted" type="button" className="w-full justify-between" onClick={toggle}>
  <span>{sectionLabel}</span>
  <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
</Button>

// Link-styled icon button (wrapping Next.js Link)
<IconButton asChild variant="ghost" size="sm">
  <Link href="/backend/settings">
    <Settings className="size-4" />
  </Link>
</IconButton>
```
