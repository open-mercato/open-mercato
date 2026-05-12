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
- [EmailInput](#emailinput)
- [SearchInput](#searchinput)
- [PasswordInput](#passwordinput)
- [WebsiteInput](#websiteinput)
- [AmountInput](#amountinput)
- [ButtonInput](#buttoninput)
- [CardInput](#cardinput)
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
- [DatePicker](#datepicker)
- [DateRangePicker](#daterangepicker)
- [TimePicker](#timepicker)
- [EmptyState](#emptystate)
- [Skeleton](#skeleton)
- [Alert](#alert)
- [Notification](#notification)
- [Accordion](#accordion)
- [LogList](#loglist)
- [RichEditor](#richeditor)
- [Specialized Inputs (overview)](#specialized-inputs-overview)
- [ComboboxInput](#comboboxinput)
- [TagsInput (backend)](#tagsinput-backend)
- [LookupSelect](#lookupselect)
- [EventSelect](#eventselect)
- [EventPatternInput](#eventpatterninput)
- [PhoneNumberField](#phonenumberfield)
- [SwitchableMarkdownInput](#switchablemarkdowninput)
- [TimeInput](#timeinput)
- [Backend shims (DatePicker / DateTimePicker / TimePicker)](#backend-shims-datepicker--datetimepicker--timepicker)
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
| Date picker | `DatePicker` (primitive) | Available — see [DatePicker](#datepicker) section. Legacy `backend/inputs/DatePicker` is a `@deprecated` shim — see [Backend shims](#backend-shims-datepicker--datetimepicker--timepicker). |
| Combobox / autocomplete | `ComboboxInput` | Available — see [ComboboxInput](#comboboxinput) section. |
| Email (Figma Email variant) | `EmailInput` | Available — see [EmailInput](#emailinput) section below. |
| Search (Figma Search variant) | `SearchInput` | Available — see [SearchInput](#searchinput) section below. |
| Password (Figma Password variant) | `PasswordInput` | Available — see [PasswordInput](#passwordinput) section below. |
| Phone (Figma Phone variant) | `PhoneNumberField` | Available — see [PhoneNumberField](#phonenumberfield) section. |
| Website / URL (Figma Website variant) | `WebsiteInput` | Available — see [WebsiteInput](#websiteinput) section below. |
| Amount with currency picker (Figma Amount variant) | `AmountInput` | Available — see [AmountInput](#amountinput) section below. |
| Input with trailing icon-button (Figma Button variant) | `ButtonInput` | Available — see [ButtonInput](#buttoninput) section below. |
| Card number with brand auto-detect (Figma Card variant) | `CardInput` | Available — see [CardInput](#cardinput) section below. |

---

## EmailInput

```typescript
import { EmailInput, type EmailInputProps } from '@open-mercato/ui/primitives/email-input'
```

Thin wrapper over `Input` that matches Figma `Text Input [1.1]` (node `266:5251`) **Email** variant. Hardcodes `type="email"`, `inputMode="email"`, `autoComplete="email"`, and renders a leading `Mail` icon by default (toggle with `showIcon={false}`). Placeholder defaults to `t('ui.inputs.emailInput.placeholder', 'name@example.com')`.

### Quick usage

```tsx
const [email, setEmail] = React.useState('')

<EmailInput
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  size="default"
/>
```

### Props

Forwards all `Input` props except `type` (locked to `email`) and `leftIcon` (managed via `showIcon`). Adds:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `showIcon` | `boolean` | `true` | Render the leading `Mail` icon. |

### MUST rules

- Use `EmailInput` (not `<Input type="email">`) for any explicit email entry — the Figma Email variant ships a mail-icon prefix, and consistency matters.
- For login flows that pair `EmailInput` with `PasswordInput`, keep `size` identical between the two rows (DS same-row sizing rule applies).
- Pass server-side validation errors via the inherited `aria-invalid` attribute — the wrapper switches to the destructive border automatically (inherited from `Input`).

---

## SearchInput

```typescript
import { SearchInput, type SearchInputProps } from '@open-mercato/ui/primitives/search-input'
```

Search input matching Figma `Text Input [1.1]` (node `266:5251`) **Search** variant — leading `Search` icon, the text input, and an optional trailing `X` button that clears the value. Built on the shared `inputWrapperVariants` / `inputElementVariants` CVA so the visual contract matches the foundation `Input` primitive.

Use for any search affordance: DataTable global filter, command-palette inputs, lookup picker chrome, list-view live filter.

### Quick usage

```tsx
const [query, setQuery] = React.useState('')

<SearchInput
  value={query}
  onChange={setQuery}
  size="default"
  placeholder={t('customers.list.search', 'Search people by name or email')}
/>
```

### Behaviors

- **Leading**: non-interactive `Search` icon (`size-4`, `text-muted-foreground`).
- **Trailing**: `X` button — renders only when `value.length > 0 && !disabled && clearable`. Real `<button>` (focusable, screen-reader-labelled via `clearLabel`).
- **`onClear`**: if not provided, the clear button calls `onChange('')`. Pass an explicit handler to also reset adjacent state (cancel in-flight request, reset paging).
- **Native search clear button**: suppressed via `appearance: none` on `::-webkit-search-cancel-button` / `::-webkit-search-decoration` so the only clear affordance is our DS button.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string` | — | Controlled. |
| `onChange` | `(next: string) => void` | — | Called on every keystroke with the new string. |
| `onClear` | `() => void` | `() => onChange('')` | Custom clear handler. |
| `clearable` | `boolean` | `true` | Show the trailing × when value is non-empty. |
| `clearLabel` | `string` | `t('ui.inputs.searchInput.clear', 'Clear search')` | Auto-translated aria-label for the clear button. |
| `placeholder` | `string` | `t('ui.inputs.searchInput.placeholder', 'Search…')` | Auto-translated. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | Forwarded to `inputWrapperVariants`. |
| `className` / `inputClassName` | `string` | — | Wrapper / inner-`<input>` overrides. |

Forwards all other `<input>` props (e.g. `name`, `id`, `aria-label`, `disabled`, `autoFocus`).

### MUST rules

- Always use `SearchInput` for search affordances — do NOT roll your own `<Input leftIcon={<Search />}>` plus a hand-rolled clear button. The DS variant handles a11y for both leading icon (decorative `aria-hidden`) and trailing clear (real button) consistently.
- Forward i18n-resolved `placeholder` for surface-specific copy; the default is generic.
- For DataTable global filter, pass `searchValue` / `onSearchChange` from `DataTable` directly into `SearchInput`'s `value` / `onChange`.

---

## PasswordInput

```typescript
import { PasswordInput, type PasswordInputProps } from '@open-mercato/ui/primitives/password-input'
```

Password input matching Figma `Text Input [1.1]` (node `266:5251`) **Password** variant — a trailing `Eye` / `EyeOff` toggle that switches the inner `<input>`'s `type` between `"password"` (default) and `"text"`. The toggle is a proper `<button>` with `aria-pressed` and a translated `aria-label`.

### Quick usage

```tsx
const [password, setPassword] = React.useState('')

<PasswordInput
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  autoComplete="current-password"
/>
```

### Controlled reveal state

```tsx
const [revealed, setRevealed] = React.useState(false)

<PasswordInput
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  revealed={revealed}
  onRevealedChange={setRevealed}
/>
```

Useful for "show password" master toggle on login screens where both password fields share the same reveal state.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `revealable` | `boolean` | `true` | Render the trailing eye toggle. Set `false` for pure password fields (e.g. read-only secrets). |
| `revealed` | `boolean` | uncontrolled | Optional controlled state. Pair with `onRevealedChange`. |
| `onRevealedChange` | `(next: boolean) => void` | — | Called on toggle. |
| `showLockIcon` | `boolean` | `true` | Render the leading `Lock` icon per Figma Password variant. Set `false` to opt out when the surface has its own labeled context. |
| `showLabel` / `hideLabel` | `string` | `t('ui.inputs.passwordInput.show'/'hide', ...)` | Auto-translated aria-labels for the toggle button. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | Forwarded to `inputWrapperVariants`. |
| `className` / `inputClassName` | `string` | — | Wrapper / inner-`<input>` overrides. |

Forwards all other `<input>` props (e.g. `name`, `id`, `autoComplete`, `aria-label`, `disabled`).

### MUST rules

- Always use `PasswordInput` for password entry — do NOT roll your own `<Input type="password">` plus a hand-rolled eye toggle. The DS variant handles `aria-pressed`, focus visibility, and i18n consistently.
- For "new password" flows, pass `autoComplete="new-password"`. For login, `autoComplete="current-password"` (the default).
- Do NOT disable `revealable` to "force" hidden input — modern UX expects a reveal toggle, and screen-reader users rely on it.
- For pairs of password fields (e.g. "password" + "confirm password"), share the `revealed` state via the controlled props so both reveal together.

---

## WebsiteInput

```typescript
import { WebsiteInput, type WebsiteInputProps } from '@open-mercato/ui/primitives/website-input'
```

URL input matching Figma `Text Input [1.1]` (node `266:5251`) **Website** variant — a left prefix box showing the protocol text (default `'https://'`), a vertical divider, then the host/path text input. Built on the shared `inputWrapperVariants` / `inputElementVariants` CVA. `type="url"`, `inputMode="url"`, `autoComplete="url"`.

### Quick usage

```tsx
const [website, setWebsite] = React.useState('www.example.com')

<WebsiteInput
  value={website}
  onChange={(e) => setWebsite(e.target.value)}
/>
```

### Notes

- The prefix is **display-only** — the inner `<input>` value contains only the host/path portion (e.g. `'www.example.com/path'`). Compose the full URL at the consumer boundary (`` `${prefix}${value}` ``) if needed.
- Override `prefix` for non-https protocols (e.g. `prefix="http://"` for legacy, or `prefix="ftp://"`).
- `showPrefix={false}` hides the prefix box entirely for surfaces that want a bare URL input.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `prefix` | `string` | `'https://'` | Protocol shown in the left prefix box. |
| `showPrefix` | `boolean` | `true` | Hide the prefix box for a bare URL input. |
| `placeholder` | `string` | `t('ui.inputs.websiteInput.placeholder', 'www.example.com')` | Auto-translated. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | — |
| `className` / `inputClassName` | `string` | — | Wrapper / inner-`<input>` overrides. |

Forwards all other `<input>` props.

### MUST rules

- Do NOT pre-pend the `prefix` value when emitting to the consumer — the prefix box is purely visual, the value is the host portion only. Consumers that need a full URL compose at the boundary.
- For freeform URL entry (where the user types the full URL including protocol), use the foundation `Input` primitive with `type="url"` and skip `WebsiteInput`.

---

## AmountInput

```typescript
import {
  AmountInput,
  AMOUNT_CURRENCIES,
  type AmountInputProps,
  type AmountValue,
  type AmountCurrency,
} from '@open-mercato/ui/primitives/amount-input'
```

Amount input matching Figma `Text Input [1.1]` (node `266:5251`) **Amount** variant — leading currency symbol inside the input, then a vertical divider, then a `Select`-driven currency picker (flag + ISO 4217 code + chevron). Numeric `inputMode="decimal"`.

Static currency list ships with 10 markets (EUR, USD, GBP, PLN, CHF, SEK, CZK, JPY, AUD, CAD). Override with the `currencies` prop, or hide the picker entirely (`showCurrency={false}`) for single-currency surfaces.

### Value shape

```ts
type AmountValue = {
  amount: string    // raw user input — preserves leading zeros, in-progress decimals like '12.'
  currency: string  // ISO 4217 code from the picker
}
```

Amount is stored as a **string** to preserve raw user input. Parse to `Number` at the API/persistence boundary (`Number.parseFloat(amount.replace(',', '.'))` for locale-friendly parsing).

### Quick usage

```tsx
const [value, setValue] = React.useState<AmountValue>({ amount: '', currency: 'EUR' })

<AmountInput
  value={value}
  onChange={setValue}
/>
```

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `AmountValue` | — | Controlled. |
| `onChange` | `(next: AmountValue) => void` | — | Called on amount keystroke and currency switch. |
| `currencies` | `AmountCurrency[]` | `AMOUNT_CURRENCIES` | Override the static list. |
| `showCurrency` | `boolean` | `true` | Hide the currency picker for single-currency surfaces. |
| `placeholder` | `string` | `t('ui.inputs.amountInput.placeholder', '0.00')` | Auto-translated. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | — |
| `className` / `inputClassName` | `string` | — | Wrapper / inner-`<input>` overrides. |

Forwards all other `<input>` props.

### MUST rules

- Always pass the controlled value as `AmountValue` (both fields). Empty initial state should still include a `currency` (e.g. `{ amount: '', currency: 'EUR' }`).
- For tenant-scoped currency configuration, build a `currencies` array from the tenant's enabled currencies (likely via `currencies` module) and pass it down — do NOT show currencies the tenant cannot transact in.
- Parse `amount` to `Number` at the API boundary, not inside the form — the string-shape preserves the user's raw input including in-progress decimals.

---

## ButtonInput

```typescript
import { ButtonInput, type ButtonInputProps } from '@open-mercato/ui/primitives/button-input'
```

Input with a trailing **interactive** button slot, matching Figma `Text Input [1.1]` (node `266:5251`) **Button** variant. A text input on the left, a vertical divider, then a slot for any `<IconButton>` / `<Button>` element. Built on the shared `inputWrapperVariants` / `inputElementVariants` CVA.

Common pairings: share-link + copy button, subscribe-email + send button, API key + regenerate button, search query + clear-and-submit button.

### Quick usage

```tsx
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Copy, Link } from 'lucide-react'

const [link, setLink] = React.useState('https://app.example.com/share/abc123')

<ButtonInput
  value={link}
  onChange={(e) => setLink(e.target.value)}
  leftIcon={<Link />}
  trailingAction={
    <IconButton
      type="button"
      variant="ghost"
      size="default"
      aria-label="Copy link"
      onClick={() => navigator.clipboard.writeText(link)}
    >
      <Copy />
    </IconButton>
  }
/>
```

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `leftIcon` | `React.ReactNode` | — | Optional decorative leading icon (wrapped in `aria-hidden` span). |
| `trailingAction` | `React.ReactNode` | — | **Required.** Interactive trailing element (typically `<IconButton>`). Rendered as-is — consumer controls type/variant/aria-label. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | — |
| `className` / `inputClassName` | `string` | — | Wrapper / inner-`<input>` overrides. |

Forwards all other `<input>` props.

### MUST rules

- `trailingAction` MUST be an interactive element (real `<button>` or `<IconButton>`), NOT a decorative icon — use `Input` with `rightIcon` for decorative icons.
- Always pass `aria-label` on the trailing button — the visual icon alone is not accessible.
- Keep `size` consistent between the wrapper and the trailing button (`size="default"` wrapper + `IconButton size="default"`).
- For trailing text buttons (e.g. "Send", "Apply"), use `<Button variant="ghost" size="sm" className="rounded-l-none h-full">` to match the wrapper height.

---

## CardInput

```typescript
import {
  CardInput,
  CARD_BRANDS,
  type CardInputProps,
  type CardBrand,
} from '@open-mercato/ui/primitives/card-input'
```

Card-number input matching Figma `Text Input [1.1]` (node `266:5251`) **Card** variant — leading `CreditCard` icon, the formatted card-number input, and a trailing brand badge that auto-detects the issuer (Visa, Mastercard, Amex, Discover, Diners, JCB, UnionPay) from the typed digits. Built on the shared `inputWrapperVariants` / `inputElementVariants` CVA.

Brand detection is **regex-based** — no external library dependency. Format per brand: `[4,4,4,4]` default, `[4,6,5]` for Amex (15 digits), `[4,6,4]` for Diners (14 digits). Trailing badge renders a 32×24 rounded rect with the brand short-label centered.

### Quick usage

```tsx
const [card, setCard] = React.useState('')

<CardInput
  value={card}
  onChange={setCard}
  onBrandChange={(brand) => console.log('Detected:', brand?.id)}
/>
```

### Value contract

- `value: string` — digits-only (no spaces). The component formats per detected brand on display.
- `onChange: (digits: string) => void` — emits digits-only (no spaces) on every keystroke. Use the digits for validation / submission.
- Non-digit characters pasted into the input are stripped silently.
- Length is truncated to the brand's `maxLength` (16 for most, 15 for Amex, 14 for Diners).

### Brand detection

```ts
type CardBrand = {
  id: string           // 'visa', 'mastercard', 'amex', etc.
  label: string        // 'VISA', 'MC', 'AMEX'
  regex: RegExp        // matched against digits-only number
  format: number[]     // grouping for display ([4,4,4,4] or [4,6,5])
  maxLength: number    // total digit cap
  bg: string           // badge background color
  fg?: string          // badge foreground (default '#fff')
}
```

Built-in list (in `CARD_BRANDS`):

| Brand | Prefix | Length | Format |
|---|---|---|---|
| Amex | 34, 37 | 15 | 4-6-5 |
| Visa | 4 | 16 | 4-4-4-4 |
| Mastercard | 51-55, 2221-2720 | 16 | 4-4-4-4 |
| Discover | 6011, 64[4-9], 65, 622 | 16 | 4-4-4-4 |
| Diners | 36, 30[0-5], 309 | 14 | 4-6-4 |
| JCB | 35[28-89] | 16 | 4-4-4-4 |
| UnionPay | 62 | 16 | 4-4-4-4 |

Order matters: narrower prefixes MUST come before broader ones (e.g. Discover `622` before UnionPay `62`).

Override with `brands={[...]}` for region-specific surfaces (e.g. only Visa/MC in a tenant-restricted checkout).

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string` | — | Digits-only (no spaces). |
| `onChange` | `(digits: string) => void` | — | Called on every keystroke with digits-only string. |
| `onBrandChange` | `(brand: CardBrand \| null) => void` | — | Fired when the detected brand changes (or clears). |
| `brands` | `CardBrand[]` | `CARD_BRANDS` | Override the brand list. |
| `showLeadingIcon` | `boolean` | `true` | Render the leading `CreditCard` icon. |
| `showBrandBadge` | `boolean` | `true` | Render the trailing brand badge when a brand is detected. |
| `placeholder` | `string` | `t('ui.inputs.cardInput.placeholder', '0000 0000 0000 0000')` | Auto-translated. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | — |
| `className` / `inputClassName` | `string` | — | Wrapper / inner-`<input>` overrides. |

Forwards all other `<input>` props. Sets `autoComplete="cc-number"` and `inputMode="numeric"`.

### Data attributes

The wrapper exposes `data-card-brand="<brand-id>"` (or `"unknown"`) so consumers can target the detected brand from CSS or tests.

### MUST rules

- Treat the card number as PCI-scoped data — do NOT log `value` or emit it via analytics. The DS primitive does not enforce this; it's a consumer responsibility.
- For payment forms, pair `CardInput` with separate inputs for expiry (`MM/YY`) and CVV — `CardInput` covers ONLY the card number.
- Server-side validation MUST run Luhn check + brand+length verification — the regex detection in this primitive is a UX hint, not authoritative.
- When constraining brands to a tenant's accepted networks, pass `brands={tenantAcceptedBrands}` — do NOT rely on hiding the badge after detection.

### Anti-patterns

- `<Input type="text" pattern="[0-9]{13,16}">` + manual space-insertion → use `CardInput`. The DS variant handles brand-specific lengths and format groups consistently.
- Storing the value with spaces in the database → consumer-side strip-spaces before persistence; the primitive already emits digits-only.

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

### Type variants (leading slot)

Per Figma `Select [1.1]` (node `270:1085`) the Select component ships **6 Type variants** that differ only in what renders BEFORE the value text in the trigger and item row — `Basic` / `Country` / `Avatar` / `Provider` / `Brand` / `Company`. The DS exposes two compound helpers to express these:

```tsx
import {
  Select, SelectTrigger, SelectTriggerLeading,
  SelectContent, SelectItem, SelectItemLeading, SelectValue,
} from '@open-mercato/ui/primitives/select'
```

| Helper | Slot | When to use |
|---|---|---|
| `SelectTriggerLeading` | Fixed visual on the trigger (renders regardless of selected value) | Category indicator, brand mark, fixed search icon. Place **before** `SelectValue`. |
| `SelectItemLeading` | Per-row leading visual; Radix `ItemText` mirrors it into the trigger when that row is selected | Country flag, avatar, provider logo — anything that varies by selected value. |

Default sizing is forgiving: child SVG icons render `size-4` (16px), child `<img>` render `size-5` (20px). Override with a class on the inner element when a Type needs a different size (e.g. country flags `h-3 w-4`).

#### Per-row leading (`SelectItemLeading`)

For Country / Avatar / Provider / Company — where each option has its own visual that should mirror into the trigger when chosen:

```tsx
// Country
<Select value={country} onValueChange={setCountry}>
  <SelectTrigger>
    <SelectValue placeholder="Select country" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="us">
      <SelectItemLeading><span className="text-base leading-none">🇺🇸</span></SelectItemLeading>
      United States
    </SelectItem>
    <SelectItem value="pl">
      <SelectItemLeading><span className="text-base leading-none">🇵🇱</span></SelectItemLeading>
      Poland
    </SelectItem>
  </SelectContent>
</Select>

// Avatar
<SelectItem value="jan">
  <SelectItemLeading><Avatar size="sm" label="Jan Kowalski" /></SelectItemLeading>
  Jan Kowalski
</SelectItem>

// Provider (lucide icon)
<SelectItem value="visa">
  <SelectItemLeading><CreditCard /></SelectItemLeading>
  Visa •••• 4242
</SelectItem>
```

The leading slot is wrapped inside `<SelectPrimitive.ItemText>`, so when the row is selected the same node appears in the trigger's `<SelectValue>` — you do NOT need to also set a `SelectTriggerLeading`.

#### Fixed trigger leading (`SelectTriggerLeading`)

For Brand or any case where the trigger always shows the SAME leading visual regardless of value:

```tsx
<Select value={brand} onValueChange={setBrand}>
  <SelectTrigger>
    <SelectTriggerLeading><Sparkles className="text-brand-violet" /></SelectTriggerLeading>
    <SelectValue placeholder="Select brand" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="om">Open Mercato</SelectItem>
    <SelectItem value="acme">Acme Corp</SelectItem>
  </SelectContent>
</Select>
```

`SelectTriggerLeading` is **independent of selection** — choose it when the leading is a fixed semantic indicator, not a property of the value.

### Props

| Prop | On | Notes |
|---|---|---|
| `value` / `onValueChange` | `Select` | Controlled value (string) |
| `defaultValue` | `Select` | Uncontrolled initial value |
| `disabled` | `Select` or `SelectTrigger` | Whole-select or per-trigger disable |
| `name` | `Select` | Hidden form input name (Radix renders for native form submit) |
| `required` | `Select` | Adds aria-required + form validation |
| `size` | `SelectTrigger` | `sm` (h-8) / `default` (h-9) / `lg` (h-10) — matches Figma X-Small / Small / Medium |
| `className` | `SelectTrigger` / `SelectTriggerLeading` / `SelectContent` / `SelectItem` / `SelectItemLeading` | Standard Tailwind override |
| `position` | `SelectContent` | `popper` (default — anchored) or `item-aligned` |

### MUST rules

- **NEVER use raw `<select>`** anywhere — always use `Select` primitive. Native dropdowns render with the OS-default styling (no Figma alignment).
- For form fields with label / error, wrap with `FormField` — handles label binding, error display, ARIA wiring.
- Same-row sizing rule applies — Select next to Input/Button MUST share `size`.
- Icons / leading visuals inside `SelectItem`: wrap in [`SelectItemLeading`](#type-variants-leading-slot) so the leading mirrors into the trigger on selection. Do not hand-roll `<span className="flex">` rows next to the label.
- For a fixed leading on the trigger (renders regardless of value), wrap in [`SelectTriggerLeading`](#type-variants-leading-slot) and place it BEFORE `<SelectValue>` — see Type variants section.
- For LARGE option lists with search, do NOT cram into `Select` — use [`ComboboxInput`](#comboboxinput) (single value) or [`LookupSelect`](#lookupselect) (rich card list) from `@open-mercato/ui/backend/inputs/*` instead.

### Specialized variants (NOT this primitive)

| Variant | Component | Status |
|---|---|---|
| Icon-only / compact trigger | `CompactSelect` | TODO — Figma node `377:5083` |
| Inline borderless trigger | `InlineSelect` | TODO — Figma node `332:4537` |
| Compact for input prefix (e.g. country code in phone) | `CompactSelectForInput` | TODO — Figma node `307:16883` |
| Single-value typeahead with suggestions | `ComboboxInput` | Available — see [ComboboxInput](#comboboxinput) section. |
| Multi-value tags with rich labels | `TagsInput` (backend) | Available — see [TagsInput (backend)](#tagsinput-backend) section. |
| Rich card-list lookup (entity picker) | `LookupSelect` | Available — see [LookupSelect](#lookupselect) section. |
| Date picker | `DatePicker` (primitive) | Available — see [DatePicker](#datepicker) section. |

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
| `xs` | 20px | Inline mentions, very compact lists |
| `sm` | 28px | Table rows, AvatarStack, inline lists |
| `md` (default) | 36px | Sidebar, comments, activity feed, assignee cards |
| `lg` | 48px | Section headers, profile cards |
| `xl` | 64px | Profile / detail page header |

```tsx
<Avatar label="Jan Kowalski" />        // → "JK"
<Avatar label="Copperleaf Design" />   // → "CD"

<AvatarStack max={3}>
  <Avatar label="Jan Kowalski" size="sm" />
  <Avatar label="Oliwia Z." size="sm" />
  <Avatar label="Anna Nowak" size="sm" />
  <Avatar label="Sarah Mitchell" size="sm" />
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

Two-row primitive (input on top, chips below) for collecting a flat list of free-form tags. Built on `Input` + `Tag shape="square"`. Use when the user types comma/separator-delimited values and the result is `string[]`. For value-from-suggestions (autocomplete with descriptions, async loaders), use [`TagsInput`](#tagsinput-backend) from `@open-mercato/ui/backend/inputs/TagsInput` instead.

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

- NEVER hand-roll `<input> + <span>` chip rows — use `TagInput` (free-form) or [`TagsInput`](#tagsinput-backend) (with suggestions/labels).
- Pass `placeholder` translated via `useT()` — primitive has no built-in i18n.
- For value+label+description triples (where `value !== label`), use [`TagsInput`](#tagsinput-backend), not `TagInput`. `TagInput` deliberately keeps the data shape flat (`string[]`).

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

## DatePicker

```typescript
import { DatePicker, type DatePickerProps, type DatePickerFooter } from '@open-mercato/ui/primitives/date-picker'
```

Single-date popover trigger per Figma `446:7413` (368×432 popover; trigger styled as Figma `Date Selector [1.1]`). Subsumes the legacy `backend/inputs/DatePicker` and `backend/inputs/DateTimePicker` via the `withTime` prop; both legacy paths are kept as `@deprecated` re-export shims so existing imports stay zero-diff. Built on the shared `Calendar` primitive, so month navigation comes from `Calendar`'s `MonthCaption` (paged prev/next month buttons with a centred caption pill, `goToMonth` from `useDayPicker()`).

### Quick usage

```tsx
const [date, setDate] = React.useState<Date | null>(null)

<DatePicker
  value={date}
  onChange={setDate}
  withTime
  minuteStep={5}
  minDate={new Date()}
  locale={pl}
  aria-label={t('orders.scheduledFor', 'Scheduled for')}
/>
```

### Footer modes

| `footer` | Behaviour |
|---|---|
| `'apply-cancel'` (default, Figma-aligned) | Selecting a day stages a draft inside the popover. `Apply` commits and closes; `Cancel` reverts and closes. |
| `'today-clear'` | Legacy footer with link-style `Today` / `Clear` buttons. Selecting a day commits immediately (set `closeOnSelect={false}` to keep the popover open). Toggle individual buttons with `showTodayButton` / `showClearButton`. |
| `'none'` | No footer; selecting a day commits and closes. |

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `Date \| null` | — | Controlled value. `null` renders the placeholder. |
| `onChange` | `(value: Date \| null) => void` | — | Called on Apply / immediate commit / Clear / Today. |
| `footer` | `'apply-cancel' \| 'today-clear' \| 'none'` | `'apply-cancel'` | Footer mode (see table above). |
| `closeOnSelect` | `boolean` | `footer === 'today-clear'` | Only meaningful in `'today-clear'` mode. |
| `showTodayButton` / `showClearButton` | `boolean` | `true` | `'today-clear'` mode only. |
| `withTime` | `boolean` | `false` | Renders an `HH:MM` `TimeInput` row under the calendar; combines into a single `Date`. |
| `minuteStep` | `number` | `1` | Forwarded to `TimeInput` when `withTime`. |
| `size` | `'sm' \| 'default'` | `'default'` | `sm` = `h-8`, `default` = `h-9`. |
| `align` | `'start' \| 'center' \| 'end'` | `'start'` | Popover alignment relative to trigger. |
| `minDate` / `maxDate` | `Date` | — | Disable out-of-range cells. |
| `locale` | `date-fns Locale` | — | Forwarded to `format()` AND the underlying `Calendar` (drives month / weekday labels). |
| `displayFormat` | `string` | derives from `locale` (`d MMM yyyy` for day-first locales, `MMM d, yyyy` otherwise; `+ HH:mm` when `withTime`) | Override the trigger label format. |
| `disabled` / `readOnly` | `boolean` | `false` | `readOnly` allows opening the popover but blocks selection commit. |
| `placeholder` | `string` | `t('ui.datePicker.placeholder', 'Pick a date')` or `t('ui.dateTimePicker.placeholder', 'Pick date and time')` when `withTime` | — |
| `className` / `popoverClassName` | `string` | — | Trigger / popover content classes. |
| `id` / `name` / `required` / `aria-label` / `aria-describedby` | — | — | Standard form/a11y forwarding. |

### MUST rules

- Locale-aware labels: pass `locale` from the user's resolved date-fns locale; do NOT hand-craft `displayFormat` strings unless the design genuinely diverges from the default day-first / month-first heuristic.
- `value` must be `Date | null` (not `string`). Convert ISO strings on the API boundary, not inside the trigger.
- Do NOT import from `@open-mercato/ui/backend/inputs/DatePicker` or `…/DateTimePicker` in new code — those are `@deprecated` shims that re-export this primitive (`<DateTimePicker>` is a thin wrapper that always sets `withTime`). New consumers import from `@open-mercato/ui/primitives/date-picker` directly. See [Backend shims](#backend-shims-datepicker--datetimepicker--timepicker) below for the full migration table.
- When `withTime`, hand `minuteStep` (typical 5/10/15) — minute-by-minute scrolling is rarely the right UX.
- Combine with `minDate` / `maxDate` for booking flows; don't post-validate after onChange.
- Pass `aria-label` (or wrap in a `FormField` with a visible label) — the trigger has no built-in label.

---

## DateRangePicker

```typescript
import {
  DateRangePicker,
  type DateRangePickerProps,
  type DateRangePresetItem,
} from '@open-mercato/ui/primitives/date-range-picker'
import { defaultDateRangePresets } from '@open-mercato/ui/primitives/date-picker-helpers'
import type { DateRange } from '@open-mercato/ui/backend/date-range'
```

Two-month range popover per Figma `446:7412` (936×432 popover, optional preset sidebar on the left). Built on the shared `Calendar` primitive (`mode='range'`, `numberOfMonths={2}`) so month navigation uses the same `MonthCaption` (paged prev/next) as `DatePicker`. The legacy `FilterOverlay` date-range UI has been migrated onto this primitive (single source of truth for range selection across the app).

### Quick usage

```tsx
const [range, setRange] = React.useState<DateRange | null>(null)

<DateRangePicker
  value={range}
  onChange={setRange}
  numberOfMonths={2}
  locale={pl}
  aria-label={t('reports.period', 'Period')}
/>
```

### Range type and presets

The range type comes from `@open-mercato/ui/backend/date-range` (single source of truth — same shape feeds dashboards, analytics, and CSV exports):

```ts
type DateRange = { start: Date; end: Date }

type DateRangePresetItem = {
  id: string
  labelKey: string                                 // i18n key, resolved via useT()
  range: (referenceDate?: Date) => DateRange       // pure getter, defaults to "now"
}
```

`defaultDateRangePresets()` (from `primitives/date-picker-helpers`) returns the canonical sidebar list aligned with the Figma Period Range track:

| `id` | `labelKey` |
|---|---|
| `today` | `ui.dateRangePicker.presets.today` |
| `last_7_days` | `ui.dateRangePicker.presets.last7Days` |
| `last_30_days` | `ui.dateRangePicker.presets.last30Days` |
| `last_3_months` | `ui.dateRangePicker.presets.last3Months` |
| `last_12_months` | `ui.dateRangePicker.presets.last12Months` |
| `month_to_date` | `ui.dateRangePicker.presets.monthToDate` |
| `year_to_date` | `ui.dateRangePicker.presets.yearToDate` |
| `all_time` | `ui.dateRangePicker.presets.allTime` |

Pass a custom array to override — each entry is `{ id, labelKey, range(refDate) }` and the getter must be pure (use `date-fns` `startOfDay` / `endOfDay` / `subMonths` etc.). `all_time` uses `new Date(0)` as `start`.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `DateRange \| null` | — | Controlled range. `null` renders the placeholder. |
| `onChange` | `(value: DateRange \| null) => void` | — | Called on Apply (when `withFooter`) or immediately on range completion / preset click (when `withFooter={false}`). |
| `presets` | `DateRangePresetItem[]` | `defaultDateRangePresets()` | Sidebar list. Empty array + `showPresets={false}` to hide. |
| `showPresets` | `boolean` | `true` | Hide the left-hand preset sidebar without dropping the data. |
| `withFooter` | `boolean` | `true` | Renders the bottom `Cancel` / `Apply` bar with a summary of the staged range. Set to `false` to commit on range completion. |
| `numberOfMonths` | `1 \| 2` | `2` | Two months side-by-side per Figma; drop to `1` for compact triggers. |
| `size` | `'sm' \| 'default'` | `'default'` | `sm` = `h-8`. |
| `align` | `'start' \| 'center' \| 'end'` | `'start'` | Popover alignment. |
| `minDate` / `maxDate` | `Date` | — | Disable out-of-range cells. |
| `locale` | `date-fns Locale` | — | Forwarded to `format()` AND the underlying `Calendar`. |
| `formatRange` | `(value: DateRange, locale?: Locale) => string` | derives from `locale` (`d MMM yyyy` / `MMM d, yyyy`, separated by an en-dash) | Override the trigger label. |
| `disabled` / `readOnly` | `boolean` | `false` | `readOnly` keeps the popover openable but blocks selection. |
| `placeholder` | `string` | `t('ui.dateRangePicker.placeholder', 'Pick a date range')` | — |
| `className` / `popoverClassName` | `string` | — | Trigger / popover content classes. |
| `id` / `name` / `required` / `aria-label` / `aria-describedby` | — | — | Standard form/a11y forwarding. |

### MUST rules

- Range type is `{ start: Date; end: Date }` (from `@open-mercato/ui/backend/date-range`), NOT `{ from, to }` — convert at the react-day-picker boundary if you ever need to interop directly.
- Pass `locale` (and forward to `Calendar` via the prop, never roll a custom caption) so month / weekday labels follow the user's locale.
- `presets[].range` getters MUST be pure and accept an optional reference date; `defaultDateRangePresets()` already does this — when extending the list, mirror the same shape.
- For dashboard-style "13 preset" UIs that share state with chart filters, pull the option list from `DATE_RANGE_OPTIONS` in `@open-mercato/ui/backend/date-range` and map it to `DateRangePresetItem[]`. Do not duplicate preset logic in the consumer.
- When migrating an old `FilterOverlay` date-range field, use this primitive — there is no longer a separate range UI inside `FilterOverlay`.
- The popover height is capped to `--radix-popover-content-available-height`; the calendar+sidebar area scrolls and the footer stays pinned, so do NOT wrap the trigger in additional `overflow-hidden` containers that fight the popover sizing.

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

- NEVER hand-roll a time-of-day input — use `TimePicker` (slots/duration/status workflow) or the legacy `backend/inputs/TimePicker` shim (free-form HH:MM trigger). See [Backend shims](#backend-shims-datepicker--datetimepicker--timepicker) for the migration table, or [TimeInput](#timeinput) when you need a bare-bones two-`<input>` hour/minute editor without any popover.
- For a row of duration chips in a custom form layout, use `<HorizontalScrollRow>` to get the same scrollbar-less + fade-gradient + chevron UX as the composition.
- When passing custom `cancelLabel` / `applyLabel` / `statusLabel` / `headerPlaceholder`, route them through `useT()` — primitive defaults are English.
- `formatDuration` is English-only — for translatable labels, define a lookup map keyed on the integer minutes value, with `t(key, fallback)` resolution inside the consumer.
- Active state for slot / duration / status uses `bg-brand-violet/10 text-brand-violet`, NOT `bg-primary/10` — `--primary` in this codebase is near-black; `--brand-violet` is the actual violet.

---

## EmptyState

```typescript
import { EmptyState, type EmptyStateProps, emptyStateVariants } from '@open-mercato/ui/primitives/empty-state'
```

Centered "nothing-to-show" panel for empty lists, empty tabs, empty DataTable cells, and zero-result search panes. Title is required; the rest (icon / illustration / description / actions) is optional. Default variant renders a dashed-border muted card; `'subtle'` drops the border for embedded contexts (inside cards / popovers / DataTable empty cells).

### Quick usage

```tsx
<EmptyState
  size="default"
  icon={<UsersRound className="h-6 w-6" aria-hidden="true" />}
  title={t('customers.empty.title', 'No customers yet')}
  description={t('customers.empty.description', 'Create your first customer to start tracking opportunities.')}
  actions={
    <Button onClick={openCreateDialog}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      {t('customers.empty.action', 'Add customer')}
    </Button>
  }
/>
```

### Variants / Sizes

| `variant` | Token | Use |
|---|---|---|
| `default` | `rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30` | Standalone empty page / tab. |
| `subtle` | `rounded-lg` (no border, no fill) | Inside cards, popovers, DataTable empty cells. |

| `size` | Padding / gap | Icon box (subtle variant) |
|---|---|---|
| `sm` | `gap-2 px-4 py-6` | `size-10` |
| `default` | `gap-3 px-6 py-10` | `size-12` |
| `lg` | `gap-4 px-8 py-16` | `size-16` |

Title type scale: `text-sm` for `sm` / `default`, `text-base` for `lg`. Description is always `text-sm text-muted-foreground` and capped to `max-w-sm` centred.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | `string` | — | Required. Rendered as `<p>` (not a heading) so it does not disrupt page heading hierarchy. |
| `description` | `string` | — | Optional muted body line under the title. |
| `icon` | `React.ReactNode` | — | Typically a `lucide-react` icon. With `variant='subtle'` it is wrapped in a round muted box (`size-10` / `size-12` / `size-16`); with `variant='default'` it sits inline tinted as `text-muted-foreground`. Ignored when `illustration` is provided. |
| `illustration` | `React.ReactNode` | — | Figma-style illustration slot (typically a scaled SVG from the DS illustrations library). Takes precedence over `icon`; rendered without any icon-box wrapping so its own background shows through. |
| `actions` | `React.ReactNode` | — | Primary action node, typically `<Button>` or a button group. |
| `children` | `React.ReactNode` | — | Alternative to `actions` for custom content rendered below the title/description block. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | Controls padding, gap, and icon-box size. |
| `variant` | `'default' \| 'subtle'` | `'default'` | See variants table. |
| `className` | `string` | — | Applied to the outer wrapper. |
| `action` / `actionLabel` / `onAction` / `actionLabelClassName` | — | — | `@deprecated` — kept only for the legacy backend `EmptyState` consumers. New code MUST use `actions={<Button>…</Button>}`. |

### MUST rules

- Title is plain text in a `<p>` — DO NOT pre-wrap it in `<h1>`/`<h2>`. If the surrounding page needs a heading, render it OUTSIDE the `EmptyState`. This keeps the heading hierarchy of the page intact wherever an empty state appears (DataTable cell, tab, dialog, etc.).
- For empty DataTable cells, use `variant='subtle'` so the dashed border doesn't double up with the table chrome.
- Prefer `illustration` over `icon` when the DS illustration library has a relevant asset — it ships with its own circular background and reads better at `size='lg'`.
- Use `actions` (not the deprecated `action` / `actionLabel` / `onAction` triple) for any new code. The deprecated props are routed to a built-in `<Button variant="outline" size="sm">` with a leading `<Plus />` icon — keep that only for legacy parity.
- Pass all strings through `useT()` — the primitive has no built-in default copy.

---

## Skeleton

```typescript
import { Skeleton, type SkeletonProps, type SkeletonShape } from '@open-mercato/ui/primitives/skeleton'
```

Inline loading placeholder for content that has a known shape but no data yet. Three shapes: `'rect'` (default block, `rounded-md`), `'circle'` (avatar / icon), and `'text'` (multi-line text with a naturally narrower last line). All sizing is done via `className` — the primitive ships only with the pulse animation and shape geometry.

### Quick usage

```tsx
{isLoading ? (
  <Skeleton shape="rect" className="h-9 w-32" />
) : (
  <Button onClick={save}>{t('actions.save', 'Save')}</Button>
)}

<div className="flex items-center gap-3">
  <Skeleton shape="circle" className="size-10" />
  <Skeleton shape="text" lines={2} className="flex-1" />
</div>
```

Composing many `Skeleton`s into a table row / card skeleton:

```tsx
<div className="space-y-2" aria-label={t('common.loading', 'Loading')}>
  {Array.from({ length: 6 }).map((_, index) => (
    <div key={index} className="flex items-center gap-3 rounded-md border p-3">
      <Skeleton shape="circle" className="size-8" />
      <Skeleton shape="rect" className="h-4 w-1/3" />
      <Skeleton shape="rect" className="ml-auto h-4 w-20" />
    </div>
  ))}
</div>
```

### Shapes

| `shape` | Renders | Default sizing | Use case |
|---|---|---|---|
| `'rect'` (default) | Single `animate-pulse bg-muted rounded-md` block | Sized via `className` (none by default) | Buttons, inputs, thumbnails, generic blocks. |
| `'circle'` | Same block with `rounded-full` | Sized via `className` (typical: `size-8` / `size-10` / `size-12`) | Avatars, status dots, icon placeholders. |
| `'text'` | `lines` (default `1`) horizontal `h-4` bars stacked with `space-y-2`. Last line is `w-3/4` when `lines > 1` to mimic natural text wrap. | `w-full` per line | Paragraph stubs, list-row labels. |

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `shape` | `'rect' \| 'circle' \| 'text'` | `'rect'` | See table above. |
| `lines` | `number` | `1` | Only meaningful for `shape='text'`. Coerced to `>= 1`. |
| `className` | `string` | — | All sizing happens here. |
| `...rest` | `React.HTMLAttributes<HTMLDivElement>` minus `role` / `aria-busy` | — | The primitive owns the accessibility attributes — do not override `role` or `aria-busy`. |

### MUST rules

- The primitive sets `role="status"`, `aria-busy="true"`, and `aria-live="polite"` automatically — do NOT pass overrides for those. If you need screen readers to announce a label, wrap a group of `Skeleton`s in a container with `aria-label={t('common.loading', 'Loading')}` (see composition example).
- Skeletons must match the final content's footprint — render the same wrapper, gap, and padding around the `Skeleton` that the loaded UI uses, so the layout doesn't jump on hydration.
- Use `shape='text'` with `lines` (don't stack three `shape='rect'` blocks by hand) — the primitive already handles the narrower final line.
- DO NOT animate skeletons differently than the built-in `animate-pulse` (e.g. shimmer libraries) — keep the loading state consistent across the app.
- Avoid sub-200ms skeleton flashes: if the underlying data resolves synchronously or from cache, render the actual content directly instead of flashing a placeholder.

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

## Notification

```typescript
import {
  Notification,
  NotificationProvider,
  NotificationStack,
  useNotification,
  type NotifyOptions,
  type NotificationEntry,
  type NotificationStackPlacement,
} from '@open-mercato/ui/primitives/notification'
// (NotificationProvider / NotificationStack / useNotification live in `notification-stack`)
import {
  NotificationProvider,
  NotificationStack,
  useNotification,
} from '@open-mercato/ui/primitives/notification-stack'
```

Card composition over `Alert` for corner-floating manual-dismiss UX — the "Notification" surface in the Figma `169:2358` Alert / Notification / Toast guidelines. Matches Figma cell `170:1839` (Error/Light/Large): status icon (or custom `avatar`), title + timestamp row, `opacity-72` description, optional row of action links, trailing dismiss X.

### When to use

| Surface | Component |
|---|---|
| Inline contextual message inside a form / page | `Alert` |
| Ephemeral "saved" / "failed" feedback (auto-dismiss) | `flash()` from `FlashMessages` (renders `Alert` under the hood) |
| Corner-floating manual-dismiss notifications (multiple stackable) | `Notification` inside `NotificationStack` (this section) |
| Persistent in-app notification panel (bell icon + popover) | `NotificationItem` / `NotificationPanel` from `@open-mercato/ui/backend/notifications` |

`Notification` is the **DS primitive** for the corner-floating case. `NotificationItem` is a richer panel-list item and stays separate by design (different layout, includes read-state indicator and module-specific renderer dispatch).

### Notification card

```tsx
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<Notification
  status="information"
  avatar={<Avatar label="John Smith" size="md" />}
  title="John commented on Acme renewal"
  description="Looped in legal for the new clause. Will follow up by EOD."
  timestamp="2 min ago"
  actions={
    <>
      <LinkButton variant="primary" onClick={openDeal}>View deal</LinkButton>
      <span className="opacity-40">·</span>
      <LinkButton variant="gray" onClick={mute}>Mute thread</LinkButton>
    </>
  }
  onDismiss={() => dismiss(id)}
/>
```

The primitive forwards every `status` / `style` value from `Alert`, defaults to `style='light'`, and always renders the dismiss X (`dismissible` defaults to `true`). Pass `avatar` to replace the default per-status Lucide icon — typical for user-driven notifications.

### Programmatic queue (`NotificationProvider` + `useNotification()`)

Mount once near the app root next to `FlashMessages`:

```tsx
// app shell (already client component)
<NotificationProvider maxVisible={5}>
  <AppContent />
  <NotificationStack placement="top-right" />
  <FlashMessages />
</NotificationProvider>
```

Then from any client component:

```tsx
function DealActions({ dealId }: { dealId: string }) {
  const { notify, dismiss } = useNotification()
  const onSave = async () => {
    const id = notify({
      status: 'success',
      title: 'Deal saved',
      description: 'Customers will be notified within 5 minutes.',
      autoDismissMs: 5000,
      actions: <LinkButton onClick={() => dismiss(id)}>Got it</LinkButton>,
    })
  }
  return <Button onClick={onSave}>Save deal</Button>
}
```

`notify()` returns the entry id; `dismiss(id)` removes it (also cancels its auto-dismiss timer). `dismissAll()` clears the queue. The provider FIFO-trims entries beyond `maxVisible` (default 5).

### `NotificationStack` placement

| `placement` | Position |
|---|---|
| `'top-right'` (default) | Top-right corner |
| `'top-left'` | Top-left corner |
| `'bottom-right'` | Bottom-right corner |
| `'bottom-left'` | Bottom-left corner |
| `'top-center'` | Top center (translated -50% via Tailwind) |
| `'bottom-center'` | Bottom center |

The wrapper has `pointer-events-none` so it does not block clicks on the page underneath; each notification card has `pointer-events-auto` so its X / action buttons stay interactive.

### Props

`Notification` accepts:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `status` | `AlertStatus` | `'information'` | Forwarded to `Alert`. |
| `style` | `AlertStyle` | `'light'` | Forwarded to `Alert`. |
| `avatar` | `ReactNode` | — | Replaces the default per-status icon. Pair with `Avatar` primitive for user-driven feeds. |
| `title` | `ReactNode` | — | `AlertTitle` (Label/Small `font-medium 14/20`). |
| `description` | `ReactNode` | — | `AlertDescription` at `opacity-72` (Paragraph/Small `14/20`). |
| `timestamp` | `ReactNode` | — | Right-aligned next to the title, `text-xs opacity-60`. Pre-format via `formatRelativeTime()` from shared. |
| `actions` | `ReactNode` | — | Row of action links rendered below the description. Wrap multiple in a fragment with manual `·` separators per Figma. |
| `dismissible` | `boolean` | `true` | Default opposite of `Alert` — notifications always need a way out. |
| `onDismiss` | `() => void` | — | Click handler for the X. When used inside `NotificationStack`, the stack provides the handler automatically. |
| `dismissAriaLabel` | `string` | `'Dismiss'` | Pass through `useT()` for i18n. |
| `id` | `string` | — | Forwarded as `data-notification-id` for external tracking. |

`NotifyOptions` (passed to `notify()`) = `Omit<NotificationProps, 'id' \| 'onDismiss'> & { autoDismissMs?: number }`.

### MUST rules

- Use `Notification` for corner-floating / stackable manual-dismiss UX. For inline alerts use `Alert` directly; for ephemeral save-feedback toasts use `flash()`; for persistent notification panel rows use `NotificationItem`.
- Always wrap the app in `NotificationProvider` if any consumer uses `useNotification()`. The hook throws when no provider is mounted — this is intentional.
- Pass `dismissAriaLabel` and translatable title / description through `useT()` — the primitive has English defaults.
- For user-driven notifications, pass `avatar={<Avatar label="..." />}` so the leading visual matches the rest of the product's identity treatment.
- Keep `autoDismissMs` short (3000–6000 ms) for transient confirmations. Omit it entirely for actionable notifications the user must address before dismissing.

---

## Accordion

```typescript
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  type AccordionTriggerIcon,
  type AccordionIconPosition,
} from '@open-mercato/ui/primitives/accordion'
```

Collapsible-section primitive built on `@radix-ui/react-accordion`. Matches Figma `210:4022` — a card with three visual states: white card + soft border + x-small shadow when closed (idle), `bg-muted` + no border + no shadow on hover or when open. The Figma `Flip Icon` toggle is exposed as `iconPosition` (`'end'` default / `'start'`) and the indicator style is selectable through `triggerIcon` (`'plus-minus'` default / `'chevron'` / `'none'`).

### Basic usage

```tsx
<Accordion type="single" collapsible>
  <AccordionItem value="payment">
    <AccordionTrigger>What payment methods are accepted?</AccordionTrigger>
    <AccordionContent>
      Major credit and debit cards (Visa, MasterCard, AmEx), plus PayPal and Apple Pay.
    </AccordionContent>
  </AccordionItem>
  <AccordionItem value="refund">
    <AccordionTrigger>How do I get a refund?</AccordionTrigger>
    <AccordionContent>
      Go to Orders → select the order → Request refund. Refunds are processed within 5 business days.
    </AccordionContent>
  </AccordionItem>
</Accordion>
```

`type="single" collapsible` is the FAQ pattern from Figma `2878:905`. Use `type="multiple"` when several panels should stay open at once (onboarding checklists, settings groups).

### Leading icon

```tsx
import { BankCard, Repeat2, MapPinTime, Lock } from 'lucide-react'

<Accordion type="single" collapsible>
  <AccordionItem value="payment">
    <AccordionTrigger leftIcon={<BankCard />}>What payment methods are accepted?</AccordionTrigger>
    <AccordionContent>…</AccordionContent>
  </AccordionItem>
</Accordion>
```

When `leftIcon` is set and `iconPosition="end"`, the parent `AccordionItem` auto-promotes its `--accordion-indent` CSS variable from 14 px to 44 px so `AccordionContent`'s left and right inner padding aligns the body with the title text (Figma `210:4064` column layout). This happens via a Tailwind v4 `has-[…trigger-left-icon]:` variant — no React state, no hydration flash.

### Indicator variants

```tsx
// Plus / Minus (default — matches Figma 210:4019 add-line / 210:4069 subtract-line)
<AccordionTrigger triggerIcon="plus-minus">…</AccordionTrigger>

// Rotating chevron (shadcn-style)
<AccordionTrigger triggerIcon="chevron">…</AccordionTrigger>

// No indicator — pair with a custom `indicator` node if needed
<AccordionTrigger triggerIcon="none" indicator={<Badge>New</Badge>}>…</AccordionTrigger>
```

### Flip-icon layout (`iconPosition="start"`)

```tsx
<AccordionTrigger iconPosition="start" triggerIcon="plus-minus">
  Customize your store-front
</AccordionTrigger>
```

Matches Figma `Flip Icon = On`. The open/close indicator becomes the leading affordance; any `leftIcon` is suppressed because the indicator owns the leading slot. Pair this with a status icon embedded inside the trigger children or with a custom `indicator` carrying both states (e.g. a `loader-2-line` for in-progress steps).

### Variants

```tsx
// Default — card with border + x-small shadow on closed state
<AccordionItem variant="card" value="a">…</AccordionItem>

// Borderless — for embedded use on a coloured surface or nav-style lists
<AccordionItem variant="borderless" value="b">…</AccordionItem>
```

### Props

`Accordion` (Radix `Root`) accepts the full `@radix-ui/react-accordion` API: `type='single' | 'multiple'`, `collapsible`, `value`, `defaultValue`, `onValueChange`, `disabled`, `dir`, `orientation`.

`AccordionItem`:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `'card' \| 'borderless'` | `'card'` | Card variant matches Figma states; borderless drops chrome for embedded use. |
| `value` | `string` | — | Required by Radix; identifies the item for `value` / `defaultValue` / `onValueChange`. |
| `disabled` | `boolean` | `false` | Disables the trigger and locks the closed state. |

`AccordionTrigger`:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `leftIcon` | `ReactNode` | — | 20×20 decorative glyph before the label. Auto-indents `AccordionContent` when `iconPosition="end"`. |
| `triggerIcon` | `'plus-minus' \| 'chevron' \| 'none'` | `'plus-minus'` | Default matches Figma add-line / subtract-line; chevron rotates 180° via `data-state=open`. |
| `iconPosition` | `'end' \| 'start'` | `'end'` | Mirrors Figma `Flip Icon` toggle. With `'start'`, `leftIcon` is suppressed. |
| `indicator` | `ReactNode` | — | Custom override for the indicator slot (overrides `triggerIcon`). |
| `headerClassName` | `string` | — | Extra classes for the internal `AccordionPrimitive.Header` (`<h3>`) wrapper. Use when the trigger row shares its line with sibling action buttons (e.g. a `RowActions` kebab next to a settings row) — set `headerClassName="min-w-0 flex-1"` so the header grows while the sibling keeps its natural size. |

`AccordionContent` forwards every `@radix-ui/react-accordion` Content prop and animates open/close via `tw-animate-css` (`animate-accordion-down` / `animate-accordion-up`) keyed off `--radix-accordion-content-height`.

### MUST rules

- Always set `value` on every `AccordionItem` — Radix requires it for controlled/uncontrolled state.
- For FAQ surfaces use `type="single" collapsible`. For onboarding / multi-section configurations use `type="multiple"`.
- Pass translatable trigger labels through `useT()` — the primitive ships no English defaults.
- When customising `triggerIcon="none"` keep the trigger reachable: either provide a meaningful `indicator` or rely on the trigger's text + `aria-expanded` for screen-reader feedback.
- Do not nest interactive elements inside `AccordionTrigger` — it is already a `<button>`. Put links and buttons inside `AccordionContent` only. If the row needs sibling actions, place them as a sibling of `AccordionTrigger` inside `AccordionItem` and grow the header with `headerClassName="min-w-0 flex-1"` (see `PipelineSettings` for the canonical example).

---

## LogList

```typescript
import {
  LogList,
  LogLevelBadge,
  type LogListEntry,
  type LogListLevel,
} from '@open-mercato/ui/backend/LogList'
```

Unified `Accordion`-driven list for admin "logs" tabs (integrations, data sync runs, payment gateway transactions, …). Replaces the per-module `<table>` + `expandedLogId` row-expand pattern with a Figma-aligned card list that uses the DS `Accordion` primitive under the hood. Each row shows time + level badge + message in the trigger; the consumer controls the expanded body content (metadata grid, JSON payload, etc.).

### Basic usage

```tsx
<LogList
  entries={logs.map((log) => ({
    id: log.id,
    time: new Date(log.createdAt).toLocaleString(),
    level: log.level,
    message: log.message,
    body: (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-card p-3 text-xs">
        {JSON.stringify(log.payload, null, 2)}
      </pre>
    ),
  }))}
  emptyMessage={t('logs.empty')}
/>
```

`LogList` uses `Accordion type='single' collapsible` internally — matches the previous "one expanded row at a time" behaviour. For multi-open admin views, drop `LogList` and compose `Accordion` directly.

### Level palette

The built-in `LogLevelBadge` maps `info` → blue, `warn` / `warning` → amber, `error` → red, `debug` → zinc. Unknown levels fall through to the default `Badge` neutral palette. Pass `levelLabel` to override the badge text (e.g. translated level names):

```tsx
{
  id: log.id,
  level: log.level,
  levelLabel: t(`payment_gateways.transactions.level.${log.level}`, log.level),
  // …
}
```

### Body slot (rich expanded content)

The `body` prop accepts any React node. Use it for metadata grids, inline / nested JSON via `JsonDisplay`, summary text, etc. The DS deployment in [`integrations/[id]/page.tsx`](../packages/core/src/modules/integrations/backend/integrations/[id]/page.tsx) builds a two-column body with a metadata grid + nested `JsonDisplay`; [`data_sync/runs/[id]/page.tsx`](../packages/core/src/modules/data_sync/backend/data-sync/runs/[id]/page.tsx) renders a single `<pre>` JSON block.

### Props

`LogList`:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `entries` | `LogListEntry[]` | — | Each entry maps to one `AccordionItem`. Pass an empty array to trigger the empty state. |
| `emptyMessage` | `ReactNode` | — | Rendered when `entries` is empty. Omit to render nothing. |
| `className` | `string` | — | Applied to the `<Accordion>` root. |

`LogListEntry`:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Required; used as the Radix Accordion item value and forwarded as `data-log-entry-id`. |
| `time` | `ReactNode` | Pre-formatted timestamp — `new Date(...).toLocaleString()` or `formatDateTime(...)`. |
| `level` | `LogListLevel` | Any string; recognized values drive the badge palette. |
| `levelLabel` | `ReactNode` | Optional translated label override; falls back to `level` verbatim. |
| `message` | `ReactNode` | One-liner shown in the trigger row (truncates). |
| `body` | `ReactNode` | Mounted lazily by Radix when the entry expands. Build the metadata grid + payload here. |

`LogLevelBadge` exposes the same level mapping for standalone use outside `LogList` (e.g. a level pill inside a detail summary card).

### MUST rules

- Pass `id` that is stable across re-renders — Radix uses it as the accordion item value, so a changing id will collapse the open row.
- Pre-format `time` in the consumer (the primitive ships no `formatDateTime`); pair with the same locale used elsewhere on the page for consistency.
- Build `body` content with the same translation keys as the legacy table headers (`<dt>` labels remain the existing `t(...)` keys, so PL / EN translations stay in sync).
- Keep `body` heavyweight (large `JsonDisplay`, fetch-on-expand) — it mounts lazily, so the closed state stays cheap regardless of payload size.

---

## RichEditor

```typescript
import {
  RichEditor,
  RichEditorToolbar,
  RichEditorIconButton,
  RichEditorTextDropdown,
  RichEditorDropdownButton,
  RichEditorColorButton,
  RichEditorColorPalette,
  RichEditorContent,
  RichEditorDivider,
  RICH_EDITOR_COLOR_PALETTE,
  type RichEditorLabels,
  type RichEditorColorKey,
  type RichEditorVariant,
} from '@open-mercato/ui/primitives/rich-editor'
```

`contentEditable`-based HTML rich text editor with a Figma-aligned toolbar (`164611:20259`). Compound API + four preset toolbar variants. Output is sanitized through the existing `sanitizeHtmlRichText` pipeline so the editor remains drop-in for any consumer that wrote against the legacy `HtmlRichTextEditor`.

### Quick usage (preset variant)

```tsx
const [value, setValue] = React.useState('<p>Hello</p>')

<RichEditor value={value} onChange={setValue} variant="standard" />
```

`variant` chooses the toolbar layout:

| Variant | Items |
|---|---|
| `'minimal'` | Bold / Italic / Underline |
| `'basic'` | Bold / Italic / Underline / Bullet list / Link |
| `'standard'` (default) | Heading dropdown / Bold / Italic / Underline / Bullet list / Numbered list / Link |
| `'full'` | Heading / Font size / Color / Bold / Italic / Underline / Strikethrough / Bullet list / Numbered list / HR / Quote / Inline code / Code block / Image / Table / Checklist / Align / Link / Comment / Mention / Help (Figma `166331:4006`) |
| `'custom'` | Render `<RichEditorToolbar>...</RichEditorToolbar>` + `<RichEditorContent />` children manually |

The `'full'` variant is what `CrudForm` `editor: 'html'` ships today (the standalone preset is the same compound API, just opted into via the variant prop on a one-off `<RichEditor />`).

### Auto-overflow toolbar (`'full'` / `'standard'` / `'basic'` / `'minimal'`)

The preset toolbar measures its container via `ResizeObserver` and renders all items in a single row. Items that don't fit spill into the existing `⋮ More` popover button (rendered as a second row of icon buttons inside the popover — same toolbar style, not a text menu). The `⋮` button auto-appears only when items overflow OR when the consumer passes a `moreMenu` prop; consumer-supplied items render at the top of the popover with a separator above auto-spilled items.

Implementation notes for consumers:

- No prop to disable — overflow is the toolbar contract; if you need a frozen layout use `variant="custom"` and supply the toolbar yourself.
- The measure pass is SSR / jsdom-safe (`typeof ResizeObserver === 'undefined'` short-circuit), so unit tests see every item under the `getByRole('button', { name })` query as if the toolbar were full-width.
- The `⋮` button omits its trailing chevron (`showChevron={false}` on `RichEditorDropdownButton`) — the three-dot glyph already signals "more actions". The `Help (?)` button does the same.

### i18n

Pass `labels` to override the English defaults. The `CrudForm` `editor: 'html'` integration maps the existing `ui.forms.richtext.*` keys (`bold`, `italic`, `underline`, `list`, `orderedList`, `heading`, `heading1`, `heading2`, `heading3`, `paragraph`, `link`, `linkUrlPrompt`, `placeholder`, `comment`, `mention`, `more`) onto this contract. Keys not yet mapped through `CrudForm` (strikethrough, checklist, color, fontSize, align*, horizontalRule, blockquote, inlineCode, codeBlock, image, imageUrlPrompt, table, help, fullscreen) fall back to the English `DEFAULT_LABELS` baked into the primitive — file an issue when you migrate a consumer that needs them.

```tsx
const t = useT()
<RichEditor
  value={value}
  onChange={setValue}
  labels={{
    bold: t('ui.forms.richtext.bold'),
    italic: t('ui.forms.richtext.italic'),
    underline: t('ui.forms.richtext.underline'),
    // …
  }}
/>
```

### Custom toolbar (compound API)

When `variant="custom"` the primitive renders no preset items — you supply the toolbar layout via children. Useful for slim toolbars, additional buttons, or third-party command bridges. Compound atoms must be rendered inside `<RichEditor>` (they read the editor context).

```tsx
<RichEditor value={value} onChange={setValue} variant="custom">
  <RichEditorToolbar>
    <RichEditorIconButton icon={<Bold />} command="bold" ariaLabel="Bold" />
    <RichEditorIconButton icon={<Italic />} command="italic" ariaLabel="Italic" />
    <RichEditorDivider />
    <RichEditorColorButton ariaLabel="Text color" command="foreColor" />
  </RichEditorToolbar>
  <RichEditorContent placeholder="Type here…" minRows={6} />
</RichEditor>
```

### Color palette (Figma `Rich Editor Colors [1.1]`, node `166331:4100`)

```ts
RICH_EDITOR_COLOR_PALETTE = {
  gray:   '#7b7b7b',
  black:  '#171717',
  white:  '#ffffff',
  blue:   '#6366f1',
  orange: '#f59e0b',
  red:    '#ef4444',
  green:  '#22c55e',
  yellow: '#f6b51e',
  purple: '#7d52f4',
  sky:    '#47c2ff',
  pink:   '#fb4ba3',
  teal:   '#22d3bb',
}
```

`<RichEditorColorButton>` uses this palette by default; pass `command="hiliteColor"` for highlight instead of `foreColor`. `<RichEditorColorPalette>` is also exported standalone for popovers or pickers that want the same swatch grid without the toolbar trigger.

### Props

`RichEditor`:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string` | `''` | HTML — sanitized through `sanitizeHtmlRichText` on every mount and on blur. |
| `onChange` | `(html: string) => void` | — | Called with the sanitized HTML when the editor loses focus. |
| `variant` | `'minimal' \| 'basic' \| 'standard' \| 'full' \| 'custom'` | `'standard'` | Toolbar preset; pass `'custom'` to render children-supplied atoms. |
| `placeholder` | `string` | `labels.placeholder` | Rendered via `data-placeholder` + Tailwind `empty:before:content`. |
| `minRows` | `number` | `4` | Sets the content area `min-height` in line-height units. |
| `disabled` | `boolean` | `false` | Disables editing + dims the surface to `opacity-60`. |
| `labels` | `Partial<RichEditorLabels>` | English defaults | Translation overrides — see i18n example above. |
| `className` / `contentClassName` | `string` | — | Compose extra utilities on the wrapper / content. |
| `aria-invalid` | `boolean` | — | Forwarded to the root for form validation styling hooks. |
| `maxLength` | `number` | — | When set, renders a character counter in the bottom-right of the content area (counts plaintext length of the sanitized HTML). |
| `onComment` | `() => void` | inserts `[comment: ]` at caret | Override the `'full'` variant Comment button (open your own popover / inline UI). |
| `onMention` | `() => void` | inserts `@` at caret | Override the `'full'` variant Mention button. |
| `moreMenu` | `React.ReactNode` | — | Custom items rendered on top of the `⋮` overflow popover (consumer-defined; auto-spilled items render below a separator). |
| `onFullscreen` | `() => void` | — | When set, the `'full'` variant renders the trailing fullscreen icon (consumer wires the actual modal/portal layout). |
| `onImageInsert` | `() => void` | DS Dialog URL prompt | Bypass the built-in URL prompt and open your own image picker. |

Toolbar atoms (`RichEditorIconButton`, `RichEditorTextDropdown`, `RichEditorDropdownButton`, `RichEditorColorButton`) expose `active`, `tooltipLabel`, `ariaLabel`, `command`, and `onActivate` props for full customization. All four follow the Figma `Rich Editor Items` spec (28×h, `rounded-md`, `bg-card` default, `bg-muted` hover/active). `RichEditorDropdownButton` additionally accepts an optional `showChevron` prop (default `true`) — set to `false` when the icon itself signals "opens a menu" (e.g. `⋮ More`, `? Help`).

### MUST rules

- Pass an `ariaLabel` on every custom toolbar button — the primitive uses it for `aria-label` and the `<title>` tooltip fallback.
- Wrap any `RichEditorToolbar` / `RichEditorIconButton` / `RichEditorTextDropdown` / `RichEditorDropdownButton` / `RichEditorColorButton` inside `<RichEditor>` — they throw outside the editor context (the error message points to the offending component).
- Keep the editor output trustworthy: do not bypass `onChange` (the sanitizer enforces the allowed tag/attr set). For custom commands, write through `useRichEditorContext().exec`.
- For server-rendered content always feed the editor through `dangerouslySetInnerHTML` of `sanitizeHtmlRichText(value)` before passing to `value` — the primitive re-sanitizes but storing pre-sanitized HTML keeps the DB clean.

---

## Specialized Inputs (overview)

These primitives live in `@open-mercato/ui/backend/inputs/*` and ship richer behavior than the foundation primitives (`Input`, `Select`, `Textarea`). Reach for them when the foundation primitive would force you to hand-roll suggestions, async loaders, validation, or rich-list selection. Anti-pattern symptoms: `<Input value="comma,separated,slugs">` for multi-value lookup, `<Select>` with 200+ items, `<input type="tel">` with custom `onBlur` E.164 normalization, raw `<textarea>` + a separate "preview" mode toggle.

### Decision rule

| If you need… | Use | Notes |
|---|---|---|
| Single value with sync/async suggestions, free-form allowed | [`ComboboxInput`](#comboboxinput) | One value (`string`). For multi-value, see `TagsInput`. |
| Multi-value tags with rich labels / descriptions / async loader | [`TagsInput`](#tagsinput-backend) | Returns `string[]`. For flat free-form chips where `value === label`, use the primitive `TagInput` instead. |
| Rich card-list search + select (title / subtitle / icon / badge) | [`LookupSelect`](#lookupselect) | Returns id (`string \| null`). Ships its own search input + debounced fetch. |
| Strict select bound to declared platform events | [`EventSelect`](#eventselect) | Groups by module; auto-fetched from `/api/events`. Mandated by `packages/ui/AGENTS.md`. |
| Event pattern entry (allow wildcards / custom patterns) | [`EventPatternInput`](#eventpatterninput) | `ComboboxInput` preloaded with declared events; permits custom strings (e.g. `sales.*`). |
| Phone-number entry with E.164 normalization + optional duplicate lookup | [`PhoneNumberField`](#phonenumberfield) | Built on `Input type="tel"`; validates on blur. |
| Rich-text input that can also operate as a plain textarea | [`SwitchableMarkdownInput`](#switchablemarkdowninput) — **@deprecated**, prefer [`RichEditor`](#richeditor) | Dynamically imports `@uiw/react-md-editor`. Kept as a backward-compatibility shim for Markdown-backed surfaces only. New rich-text fields MUST use `RichEditor` (sanitized HTML). |
| Bare `HH:MM` editor (two number inputs, no popover) | [`TimeInput`](#timeinput) | Low-level atom — most flows want `TimePicker`. |
| Date / Date+Time / Time picker with popover | `DatePicker` / `DatePicker withTime` / `TimePicker` primitives | The `backend/inputs/{DatePicker,DateTimePicker,TimePicker}` modules are `@deprecated` shims — see [Backend shims](#backend-shims-datepicker--datetimepicker--timepicker). |

### MUST rules (global)

- NEVER mount these inside `FormField` twice — they each render their own internal `<input>` / trigger. If you need a label + description row, wrap in a single `FormField` and pass the specialized primitive as the field control.
- All write through `onChange` / `onValueChange` props — never read DOM values manually. They are controlled components.
- For dialog forms wired through `CrudForm`, the auto-focus contract is honored via `data-crud-focus-target=""` already set on the inner element. Do NOT add your own `autoFocus` unless you mean to override CrudForm's first-field focus.
- These primitives ship default English copy (placeholder, "Loading…", "No results", "Type to search…") that callers SHOULD override via `useT()` for translated surfaces.

---

## ComboboxInput

```typescript
import { ComboboxInput, type ComboboxInputProps, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
```

Single-value typeahead with sync and/or async suggestions. Filters the merged option list against the typed query, supports keyboard navigation, and (by default) allows free-form custom values when no suggestion matches. Used inside `EventPatternInput`, custom-field dictionary editors, and dictionary-backed form fields.

### Quick usage

```tsx
const [value, setValue] = React.useState<string>('')

<ComboboxInput
  value={value}
  onChange={setValue}
  placeholder={t('customers.industry.placeholder', 'Industry')}
  suggestions={[
    { value: 'saas', label: 'SaaS', description: 'Software-as-a-Service' },
    { value: 'ecom', label: 'E-commerce' },
    'manufacturing',  // bare strings auto-normalize to { value, label }
  ]}
  allowCustomValues
/>
```

### Async loader

```tsx
<ComboboxInput
  value={value}
  onChange={setValue}
  loadSuggestions={async (query) => {
    const res = await apiCall<{ items: Array<{ value: string; label: string }> }>(
      `/api/customers/industries?q=${encodeURIComponent(query ?? '')}`
    )
    return res.result?.items ?? []
  }}
  resolveLabel={(val) => industriesById[val]?.label ?? val}
/>
```

`loadSuggestions` is debounced 200 ms after the user types. Pass `resolveLabel` (and optionally `resolveDescription`) so an incoming `value` that is not yet in the loaded list still renders a human-friendly label.

### Behaviors

- **Keyboard**: `↓` opens the popup / moves selection down. `↑` moves up. `Enter` commits the highlighted suggestion or the typed text. `Escape` closes the popup.
- **Blur**: a 200 ms delay before commit lets `onClick` on a suggestion win the race.
- **`allowCustomValues={false}`**: on blur or `Enter`, if the typed text does not match any option (by value or case-insensitive label), the input reverts to the current `value`.
- **Inner element**: deliberately a raw `<input>` (not the `Input` primitive) — the focus / suggestion-popup interplay relies on a plain input. The raw element is styled to *match* the DS `Input` visual contract (`h-9 rounded-md border-input shadow-xs`, `focus-visible:shadow-focus focus-visible:border-foreground`, `placeholder:text-muted-foreground`). Do not "fix" by swapping to the DS `Input` wrapper.
- **Popup visual**: `rounded-2xl` container with Figma drop-shadow (`0 16px 32px -12px rgba(14,18,27,0.1)`), `p-2`, items `rounded-lg p-2` with `bg-muted` for keyboard-highlighted row — matches the DS `SelectContent` / `SelectItem` token contract.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string` | — | Controlled. The committed value; may or may not exist in `suggestions`. |
| `onChange` | `(next: string) => void` | — | Called on commit (selection, `Enter`, or blur). Trimmed. |
| `suggestions` | `Array<string \| ComboboxOption>` | — | Sync options. Strings auto-normalize to `{ value, label }`. |
| `loadSuggestions` | `(query?: string) => Promise<Array<string \| ComboboxOption>>` | — | Async loader; debounced 200 ms. Merged with `suggestions`. |
| `resolveLabel` | `(value: string) => string` | — | Resolve a label for a `value` not present in current option set. |
| `resolveDescription` | `(value: string) => string \| null \| undefined` | — | Resolve a description likewise. |
| `placeholder` | `string` | `t('ui.inputs.comboboxInput.placeholder', 'Type to search...')` | Auto-translated; override per surface if needed. |
| `autoFocus` | `boolean` | — | — |
| `disabled` | `boolean` | `false` | — |
| `allowCustomValues` | `boolean` | `true` | When `false`, blur / `Enter` on an unmatched value reverts. |

### MUST rules

- For multi-value lookup (`string[]`), use [`TagsInput`](#tagsinput-backend) — do NOT roll your own array logic on top of `ComboboxInput`.
- Pass `resolveLabel` whenever the committed `value` differs from a display label (id-vs-name dictionaries) — otherwise the trigger shows the raw id on first render.
- Do NOT replace the inner `<input>` with the DS `Input` primitive — see "Inner element" above.
- For event-pattern fields (with wildcards), use [`EventPatternInput`](#eventpatterninput) — it composes this primitive with a declared-events loader.

### Anti-patterns

- `<Input value={a} onChange={...} />` + a hand-rolled `<ul>` of suggestions → use `ComboboxInput`.
- `<Select>` with hundreds of `<SelectItem>`s and `onSearchChange` glue → use `ComboboxInput` with `loadSuggestions`.

---

## TagsInput (backend)

```typescript
import { TagsInput, type TagsInputProps, type TagsInputOption } from '@open-mercato/ui/backend/inputs/TagsInput'
```

Multi-value version of `ComboboxInput`. Renders selected values as `Tag shape="square" variant="default"` chips inline with the typing surface, supports sync/async suggestions with rich `{ value, label, description }` triples, and emits a `string[]`. Use whenever the form field is a flat list of dictionary-backed identifiers (tags, categories, segments, custom-field multi-select).

### TagsInput (backend) vs `TagInput` (primitive)

| | `TagsInput` (backend) | `TagInput` (primitive) |
|---|---|---|
| Import | `@open-mercato/ui/backend/inputs/TagsInput` | `@open-mercato/ui/primitives/tag-input` |
| Value shape | `string[]` (id-like values, often with a separate label) | `string[]` (free-form, where value === label) |
| Suggestions | sync + async loaders, with `{ value, label, description }` | none (free typing only) |
| `resolveLabel` / `resolveDescription` | ✅ for id-vs-label dictionaries | ❌ |
| Keyboard add | `Enter` / `,` | `Enter` / `,` / `Tab` (configurable) |
| Use case | dictionary-backed multi-select (industries, segments, scopes) | free-form keyword chips (search filters, ad-hoc labels) |

### Quick usage

```tsx
const [tags, setTags] = React.useState<string[]>([])

<TagsInput
  value={tags}
  onChange={setTags}
  placeholder={t('customers.segments.placeholder', 'Add segment')}
  loadSuggestions={async (query) => {
    const res = await apiCall<{ items: TagsInputOption[] }>(
      `/api/customers/segments?q=${encodeURIComponent(query ?? '')}`
    )
    return res.result?.items ?? []
  }}
  selectedOptions={currentSelectionWithLabels}
  resolveLabel={(val) => segmentsById[val]?.label ?? val}
/>
```

### Behaviors

- **Keyboard**: `Enter` or `,` commits the current input as a tag. `Backspace` on an empty input removes the last tag.
- **Suggestions popup**: shown on focus (`showSuggestionsOnFocus`, default `true`), filtered by the merged option map (`suggestions` + async + `selectedOptions` + current values resolved via `resolveLabel`).
- **Blur commit**: if the user clicks a suggestion the chip commits via the suggestion's `mousedown` (the input's blur is suppressed for one cycle).
- **Tag rendering**: uses the DS `Tag` primitive with `shape="square"` so chips align with the typing baseline; description (if any) renders as a small `text-overline text-muted-foreground` line under the label.
- **i18n**: built-in keys `ui.inputs.tagsInput.removeTag` (default `'Remove {label}'`) and `ui.inputs.tagsInput.placeholder` (default `'Add tag and press Enter'`).

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string[]` | — | Controlled list of committed values. |
| `onChange` | `(next: string[]) => void` | — | Emits the new array on add/remove. Trimmed values; duplicates ignored. |
| `suggestions` | `Array<string \| TagsInputOption>` | — | Sync options. |
| `loadSuggestions` | `(query?: string) => Promise<Array<string \| TagsInputOption>>` | — | Debounced 200 ms. |
| `selectedOptions` | `TagsInputOption[]` | — | Rich `{ value, label, description }` triples for current `value` entries. Avoids round-tripping to async loader to render chip labels. |
| `resolveLabel` | `(value: string) => string` | — | Fallback label resolver for values without a matching option. |
| `resolveDescription` | `(value: string) => string \| null \| undefined` | — | Fallback description resolver. |
| `placeholder` | `string` | `t('ui.inputs.tagsInput.placeholder', 'Add tag and press Enter')` | — |
| `autoFocus` | `boolean` | — | — |
| `disabled` | `boolean` | `false` | Renders muted background + disables chip remove. |
| `allowCustomValues` | `boolean` | `true` | When `false`, ignores `Enter` on unmatched input. |
| `showSuggestionsOnFocus` | `boolean` | `true` | When `false`, popup opens only after the user types. |

### MUST rules

- Use this primitive (not `TagInput`) whenever `value` is an identifier (segment id, dictionary code) and the display label / description live separately. `TagInput` is for flat free-form chips only.
- Pass `selectedOptions` for the current `value` so chips render labels without re-running the async loader on mount.
- Do NOT pass `<Tag>` markup as children — chips are managed internally. If you need different chip variants per tag (e.g. coloured by category), open an issue rather than wrapping the primitive.
- Always wire `loadSuggestions` to a server-side filter (`?q=`) when the dictionary exceeds ~50 entries; do not load the full list client-side.

### Anti-patterns

- `<Input value="a,b,c" onChange={...} />` + manual `.split(',')` → use `TagsInput`.
- `<Select multiple>` (native HTML) → no Tags-like UX; use `TagsInput`.
- Building your own chip row with `<Tag>` + `<input>` next to it → that is exactly what this primitive composes.

---

## LookupSelect

```typescript
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs/LookupSelect'
```

Card-list search/select for picking one rich record from a (typically) large dataset. Renders its own search field plus a vertically scrollable list of cards (`title`, `subtitle`, `description`, `rightLabel`, `badge`, `icon`, `disabled`). Returns a single id (`string \| null`) — for multi-pick flows, build a wrapper that calls `onChange` repeatedly on a parent array.

### Quick usage

```tsx
const [id, setId] = React.useState<string | null>(null)

<LookupSelect
  value={id}
  onChange={setId}
  minQuery={2}
  fetchItems={async (query) => {
    const res = await apiCall<{ items: LookupSelectItem[] }>(
      `/api/customers/people?q=${encodeURIComponent(query)}&limit=20`
    )
    return res.result?.items ?? []
  }}
  searchPlaceholder={t('customers.lookup.search', 'Search by name or email')}
  emptyLabel={t('customers.lookup.empty', 'No matches')}
  actionSlot={
    <Button type="button" variant="outline" size="sm" onClick={openCreateDialog}>
      <Plus className="size-4" />
      {t('customers.lookup.create', 'New person')}
    </Button>
  }
/>
```

### Sync vs async

| Mode | Pass | Behavior |
|---|---|---|
| Sync | `options: LookupSelectItem[]` | Renders `options` as-is. `fetchItems` is ignored. Reactive — passing a new array re-renders the list. |
| Async | `fetchItems(query)` *or* the legacy `fetchOptions(query)` alias | Debounced 220 ms. Fires when `query.length >= minQuery` OR `defaultOpen` is set OR a `value` is preselected. |

If both are passed, the async loader wins as soon as the user types. Keep your loader cancellable on the caller side — the primitive cancels its own in-flight promise on next query but does NOT propagate `AbortSignal`.

### Item shape

```ts
type LookupSelectItem = {
  id: string
  title: string
  subtitle?: string | null
  description?: string | null
  rightLabel?: string | null      // small uppercase tracked label on top right (country code, status badge etc.)
  badge?: string | null
  icon?: React.ReactNode          // 48×48 leading slot (rounded-lg). Falls back to the first letter of `title`.
  disabled?: boolean              // disables the row unless it is currently selected
}
```

### Visual

- Container: vertical card list, `gap-1.5`, `max-h-80` scroll
- Card: `rounded-xl border p-4` with `gap-4` between the 48×48 leading slot, the text column, and the trailing checkmark slot
- Leading slot: **frameless** when `item.icon` is provided (the icon brings its own visual — Avatar circle, lucide icon, etc.). The styled `rounded-lg border bg-muted` box renders ONLY for the fallback first-letter case, so Avatar / icon don't get a redundant square frame around them.
- Default state: `border-input bg-card` with `hover:border-foreground/20 hover:bg-muted/30 hover:shadow-sm` (subtle elevation)
- Selected state: `border-brand-violet bg-brand-violet/5 shadow-sm` with a `Check` icon (`size-5 text-brand-violet`) on the right and the leading icon box tinted `bg-brand-violet/10`
- The right-hand `Select` / `Selected` button has been **removed** — the entire row is the click target. The resolved labels are still exposed via the row's `title` attribute (browser tooltip + screen-reader hint) for backward compatibility
- Typography: title `text-sm font-semibold`, subtitle `text-xs text-muted-foreground`, description `text-xs text-muted-foreground/70`, `rightLabel` `text-overline uppercase tracking-wider text-muted-foreground`

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string \| null` | — | Selected item id. |
| `onChange` | `(next: string \| null) => void` | — | Called on row click or "Clear selection". |
| `fetchItems` | `(query: string) => Promise<LookupSelectItem[]>` | — | Async loader (preferred). |
| `fetchOptions` | `(query?: string) => Promise<LookupSelectItem[]>` | — | Legacy alias. Prefer `fetchItems`. |
| `options` | `LookupSelectItem[]` | — | Sync list. Mutually exclusive with `fetchItems`/`fetchOptions`. |
| `minQuery` | `number` | `2` | Minimum query length before the loader fires. Bypassed by `defaultOpen` or a preselected `value`. |
| `defaultOpen` | `boolean` | `false` | Loads on mount and ignores `minQuery`. |
| `actionSlot` | `React.ReactNode` | — | Right-of-search slot, typically a "Create new" button. |
| `onReady` | `(controls: { setQuery: (value: string) => void }) => void` | — | Receives a parent-driven query setter (deep-linking, "Search again" buttons). |
| `searchPlaceholder` | `string` | `placeholder ?? t('ui.lookupSelect.searchPlaceholder', 'Search…')` | Auto-translated. |
| `placeholder` | `string` | — | Convenience alias for `searchPlaceholder`. |
| `clearLabel` | `string` | `t('ui.lookupSelect.clearSelection', 'Clear selection')` | Auto-translated. |
| `emptyLabel` | `string` | `t('ui.lookupSelect.noResults', 'No results')` | Auto-translated; also rendered as the error fallback. |
| `loadingLabel` | `string` | `t('ui.lookupSelect.searching', 'Searching…')` | Auto-translated. |
| `selectLabel` / `selectedLabel` | `string` | `t('ui.lookupSelect.select', 'Select')` / `t('ui.lookupSelect.selected', 'Selected')` | Auto-translated button labels per row. |
| `minQueryHintLabel` | `string` | `t('ui.lookupSelect.minQueryHint', 'Type at least {minQuery} characters or paste an id to search.', { minQuery })` | Shown when the user has typed but below `minQuery`. |
| `startTypingLabel` | `string` | `t('ui.lookupSelect.startTyping', 'Start typing to search.')` | Auto-translated. |
| `selectedHintLabel` | `(id: string) => string` | — | Future hook for an inline preview block (currently unused by the primitive — pass through for forward-compat). |
| `disabled` | `boolean` | `false` | Disables both the search input and row interaction. |
| `loading` | `boolean` | `false` | Force the loading state regardless of the internal fetch — useful when the parent owns the request. |

### MUST rules

- All default labels (`searchPlaceholder`, `clearLabel`, `emptyLabel`, `loadingLabel`, `selectLabel`, `selectedLabel`, `startTypingLabel`, `minQueryHintLabel`) are auto-translated via `useT()` against `ui.lookupSelect.*` keys. Override only when the surface needs custom copy.
- Search input is styled `h-10 rounded-lg border-input shadow-xs focus-visible:shadow-focus focus-visible:border-brand-violet` — slightly bigger and more rounded than a standard form `Input` to read as a picker chrome rather than a form field. The leading search icon sits at `left-3.5`. Card rows use `rounded-xl p-4` with selected state `border-brand-violet bg-brand-violet/5 shadow-sm` and a leading `Check` icon (DS active token).
- Set `minQuery` to match the API's minimum filter length (typically 2 or 3). For pre-loaded short lists, switch to `options` instead of `fetchItems`.
- Use `actionSlot` for a "Create new" affordance — do not render a separate `<Button>` outside the primitive that breaks the search-row alignment.
- For modules with permission-gated lookup APIs, route `fetchItems` through `apiCall`/`apiCallOrThrow` so 401/403 flows reach the global error handler.
- For single-value form fields, prefer wrapping `LookupSelect` in a `FormField`-styled label/description block; do not duplicate the label inside `searchPlaceholder`.

### Anti-patterns

- `<Select>` with a long `<SelectItem>` list of records → `LookupSelect` ships the search + card UX out of the box.
- `<ComboboxInput>` for selecting a record (id + subtitle + icon) → `LookupSelect` is the right primitive for entity pickers.

---

## EventSelect

```typescript
import { EventSelect, useAvailableEvents, type EventDefinition, type EventSelectProps } from '@open-mercato/ui/backend/inputs/EventSelect'
```

Strict `Select`-style picker bound to the declared platform events. Fetches `/api/events?excludeTriggerExcluded=...` via TanStack Query (5-minute `staleTime`), groups options by module under `<SelectLabel>`, and emits the selected event id. **The root `packages/ui/AGENTS.md` mandates this primitive whenever users select a declared event** — never roll a manual `<Select>` over the events API.

### Quick usage

```tsx
const [eventId, setEventId] = React.useState<string>('')

<EventSelect
  value={eventId}
  onChange={setEventId}
  categories={['crud', 'lifecycle']}
  modules={['sales', 'customers']}
  placeholder={t('subscribers.event.placeholder', 'Select an event')}
/>
```

### Behaviors

- Loading state: trigger is disabled while the API request is in flight; placeholder reads `t('ui.inputs.eventSelect.loading', 'Loading...')`.
- Empty state (after filters): trigger placeholder reads `t('ui.inputs.eventSelect.empty', 'No events available')`; still disabled.
- Grouping: events are bucketed by `module` (falling back to `'other'`), with modules sorted alphabetically and capitalized for display.
- Cache: shared with `useAvailableEvents` (same `queryKey: ['declared-events', excludeTriggerExcluded]`). Toggling `excludeTriggerExcluded` produces a separate cache entry.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string` | — | Selected event id. Empty string renders the placeholder. |
| `onChange` | `(eventId: string) => void` | — | Emits the selected id (or `''` if Radix passes `null`). |
| `placeholder` | `string` | `t('ui.inputs.eventSelect.placeholder', 'Select an event...')` | Overridden by loading / empty placeholders when applicable. |
| `className` | `string` | — | Applied to the `<SelectTrigger>`. |
| `disabled` | `boolean` | — | OR'd with `isLoading`. |
| `categories` | `Array<'crud' \| 'lifecycle' \| 'system' \| 'custom'>` | — | Filter — empty/undefined means all. |
| `modules` | `string[]` | — | Filter — empty/undefined means all. |
| `excludeTriggerExcluded` | `boolean` | `true` | Filters out events flagged `excludeFromTriggers: true` in their `EventDefinition`. Set to `false` for the rare admin / debug UI that needs every declared event. |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | Trigger row height — matches the DS `SelectTrigger` size contract. The pre-DS-align version of this component hardcoded `'lg'`; pass `size="lg"` explicitly if you need the legacy taller trigger. |

### `useAvailableEvents` hook

```tsx
const { events, eventsByModule, isLoading, error, refetch } = useAvailableEvents({
  categories: ['crud'],
  modules: ['sales'],
  excludeTriggerExcluded: true,
})
```

Returns the same filtered/grouped data the primitive uses internally — reach for it when you need a non-`Select` UI (radio list, table-style picker, settings preview).

### MUST rules

- NEVER call `/api/events` directly from a component — use `EventSelect` or `useAvailableEvents` so the cache is shared.
- Pass `categories` / `modules` filters early — server-side filtering is not yet available, so client filtering keeps the dropdown short.
- The default `placeholder` / loading / empty copy is auto-translated via `useT()` against `ui.inputs.eventSelect.*` — override `placeholder` only when the surface needs custom copy distinct from the global default.
- For UIs that need to accept wildcard / custom patterns (e.g. `sales.*`), use [`EventPatternInput`](#eventpatterninput) instead.

### Anti-patterns

- `<Select>` populated by `fetch('/api/events')` in a `useEffect` → bypass cache + duplicates code; use `EventSelect`.
- `<ComboboxInput suggestions={eventsList}>` for a strict selection (no wildcards) → use `EventSelect`; combobox blur-commits on free text.

---

## EventPatternInput

```typescript
import { EventPatternInput, type EventPatternInputProps } from '@open-mercato/ui/backend/inputs/EventPatternInput'
```

`ComboboxInput` preloaded with declared events (via `useAvailableEvents`) that **allows custom values**. Use for fields where the operator types an event pattern that MAY include wildcards or not-yet-declared event ids — typical surfaces: subscriber configuration, webhook trigger filter, workflow trigger pattern, audit log filter.

### Quick usage

```tsx
const [pattern, setPattern] = React.useState<string>('')

<EventPatternInput
  value={pattern}
  onChange={setPattern}
  placeholder="sales.orders.*"
  categories={['crud', 'lifecycle']}
/>
```

### Behaviors

- Suggestion list is built from declared events: each event becomes `{ value: event.id, label: event.label, description: event.id }`.
- `allowCustomValues={true}` is hardcoded — the operator can type any string (e.g. `sales.*`, `custom.thing.happened`) and commit it on blur or `Enter`.
- All other behaviors mirror [`ComboboxInput`](#comboboxinput) (keyboard nav, 200 ms debounce on async path — though async is not used here, the loader cache is the shared `useAvailableEvents` query).

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string` | — | Current pattern (event id or wildcard expression). |
| `onChange` | `(pattern: string) => void` | — | Emits committed pattern. |
| `placeholder` | `string` | `t('ui.inputs.eventPatternInput.placeholder', 'sales.orders.created')` | Auto-translated via `useT()` — override only for surface-specific copy. Event ids stay language-agnostic across locales. |
| `disabled` | `boolean` | — | — |
| `categories` | `Array<'crud' \| 'lifecycle' \| 'system' \| 'custom'>` | — | Forwarded to `useAvailableEvents`. |
| `modules` | `string[]` | — | Forwarded to `useAvailableEvents`. |

### MUST rules

- For fields that must accept ONLY a declared event id (no wildcards), use [`EventSelect`](#eventselect) — its strict select prevents typos.
- Document the wildcard syntax somewhere reachable (typically a `FormField` description) — the primitive shows suggestions but does not advertise the wildcard grammar.
- Keep `placeholder` aligned with the consumer's expected pattern (e.g. `sales.orders.*`, `customers.person.created`) so the example doubles as documentation.

### Anti-patterns

- `<Input value={pattern} onChange={...} />` for an event-pattern field → users can't discover available events; use `EventPatternInput`.
- `<EventSelect>` followed by a separate "or type custom pattern" `<Input>` → fold both affordances into `EventPatternInput`.

---

## PhoneNumberField

```typescript
import { PhoneNumberField, type PhoneNumberFieldProps, type PhoneDuplicateMatch } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
```

Phone-number input matching Figma `Text Input [1.1]` (node `266:5251`) **Phone** variant: a single compound field with a country picker on the left (flag + dial code + chevron), a vertical divider, and the national-number text input on the right — all sharing one rounded-[10px] border, shadow-xs, and focus ring. The component preserves the original prop contract (`value: string` E.164 in, same out) by splitting the value internally into `country` + `localNumber` state and re-composing on every change.

Country list ships as a static export (`PHONE_COUNTRIES`) — 16 markets (US, CA, GB, PL, DE, FR, ES, IT, NL, SE, AT, CH, PT, CZ, RO, UA). Override per surface with the `countries` prop. Default fallback is US (`+1`); override with `defaultCountryIso2`.

Validates and normalizes on blur via `validatePhoneNumber` from `@open-mercato/shared/lib/phone`, with optional duplicate lookup (debounced 350 ms) that surfaces an existing contact link inline. Used in the customer-create flow, contact forms, and any onboarding step that captures a phone number.

### Quick usage

```tsx
const [phone, setPhone] = React.useState<string | undefined>(undefined)

<PhoneNumberField
  id="phone"
  value={phone}
  onValueChange={setPhone}
  externalError={fieldErrors.phone}
  placeholder="+1 212 555 1234"
  invalidLabel={t('customers.phone.invalid', 'Enter a valid phone number with country code.')}
  onDuplicateLookup={async (digits) => findExistingByPhone(digits)}
  duplicateLabel={(match) => t('customers.phone.duplicate', 'Looks like {label} already uses this number', { label: match.label })}
  duplicateLinkLabel={t('customers.phone.duplicateLink', 'Open record')}
  checkingLabel={t('customers.phone.checking', 'Checking for duplicates…')}
/>
```

### Behaviors

- **Country selection**: opens a DS `Select` dropdown showing flag + label + dial code per country. Switching country re-emits `value` with the new dial code prepended to the current local digits.
- **Local-number entry**: the right-hand `<input type="tel">` only holds the national portion (no dial-code prefix in the visible text). Internally the component re-composes `${dialCode} ${local}` on every change and emits it via `onValueChange`.
- **On blur**: runs `validatePhoneNumber(composed)`. If valid → re-splits the normalized form back into `country` + `localNumber` and emits the normalized full string; if invalid → sets `aria-invalid="true"` and shows `invalidLabel`.
- **Initial country**: parsed from incoming `value` by matching the longest dial-code prefix. Falls back to `defaultCountryIso2` (or US) when `value` is empty or unparseable.
- **Duplicate lookup**: debounced 350 ms; fires when `extractPhoneDigits(composed).length >= minDigits` (default `6`). Errors silently swallow (no toast).
- **Error precedence**: `externalError` (e.g. server-side Zod) > internal `validationHint` > duplicate match (informational only, amber/warning). Duplicate is hidden whenever any error is showing.
- **Visual**: container `rounded-[10px] border shadow-xs`. Focus state replaces the border with `border-brand-violet` and adds `shadow-focus`; error state replaces with `border-status-error-icon`. Tokens: error `text-status-error-text`, duplicate `text-status-warning-text`, duplicate link `text-brand-violet`.
- **Externally driven sync**: if `value` updates externally while the user is NOT actively editing, both `country` and `localNumber` are re-derived from the new value.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `id` | `string` | — | Used to build `aria-describedby` for the error message (`${id}-error`). |
| `value` | `string \| null` | — | Controlled value. `null`/empty renders empty field. |
| `onValueChange` | `(next: string \| undefined) => void` | — | Emits raw on change, normalized on valid blur, `undefined` on cleared. |
| `onDigitsChange` | `(digits: string \| null) => void` | — | Optional — emits the extracted digit string (no country prefix). |
| `externalError` | `string \| null` | — | Server / Zod error. Takes precedence over internal validation hint. |
| `disabled` | `boolean` | `false` | Disables duplicate lookup as well. |
| `autoFocus` | `boolean` | — | — |
| `ariaLabel` | `string` | — | Forwarded to the national-number input; suffixed with `" country"` for the country picker trigger. |
| `ariaDescribedBy` | `string` | — | Merged with the error id when an error is shown. |
| `placeholder` | `string` | `'(555) 000-0000'` | Placeholder for the national-number input only — the country picker shows the selected dial code. |
| `countries` | `PhoneCountry[]` | `PHONE_COUNTRIES` | Override the country list (e.g. limit to specific markets). Longest dial codes MUST appear before shorter ancestors. |
| `defaultCountryIso2` | `string` | `'US'` | Initial country when `value` is empty / unparseable. |
| `minDigits` | `number` | `6` | Lower bound for triggering duplicate lookup. |
| `checkingLabel` | `string` | `t('ui.inputs.phoneNumberField.checking', 'Checking for duplicates…')` | Auto-translated; override per surface if needed. |
| `duplicateLabel` | `(match: PhoneDuplicateMatch) => string` | — | Required to render the duplicate callout — no sensible default because the copy depends on the match's `label`. |
| `duplicateLinkLabel` | `string` | `t('ui.inputs.phoneNumberField.duplicateLink', 'Open record')` | Auto-translated; override per surface if needed. |
| `invalidLabel` | `string` | `t('ui.inputs.phoneNumberField.invalid', 'Enter a valid phone number with country code (e.g. +1 212 555 1234)')` | Auto-translated; override per surface if needed. |
| `onDuplicateLookup` | `(normalizedValue: string) => Promise<PhoneDuplicateMatch \| null>` | — | Provide to enable the duplicate-detection branch. |

### MUST rules

- Default `invalidLabel` / `checkingLabel` / `duplicateLinkLabel` are auto-translated via `useT()` against `ui.inputs.phoneNumberField.*` keys. Override only when the surface needs custom copy that differs from the global default.
- Surface server-side errors via `externalError`, not by setting `validationHint` manually — it has precedence and integrates with `aria-invalid`.
- Implement `onDuplicateLookup` against an authenticated, tenant-scoped API; it receives the normalized digits string (no `+`), so server-side comparison should normalize the same way.
- For phone columns in CRUD lists, pair this field with a server-side unique constraint — the duplicate lookup is informational, not authoritative.

### Anti-patterns

- `<Input type="tel">` + manual `onBlur` running E.164 normalization → use `PhoneNumberField`.
- Reading `extractPhoneDigits` on every render of a parent component → pass `onDigitsChange` and store the result alongside `value`.

---

## SwitchableMarkdownInput

> **@deprecated** — Prefer the DS [`RichEditor`](#richeditor) primitive for any new rich-text input. The DS direction is to consolidate on a single rich-text format (sanitized HTML) so user-authored content renders consistently across email, exports, and the customer portal. `SwitchableMarkdownInput` remains as a backward-compatibility shim until existing Markdown-backed surfaces (customers Notes, agent prompts) migrate their storage format. Do NOT introduce new Markdown surfaces; pick `RichEditor` for HTML or a plain `Textarea` for plain text.

```typescript
import { SwitchableMarkdownInput, type SwitchableMarkdownInputProps } from '@open-mercato/ui/backend/inputs/SwitchableMarkdownInput'
```

A controlled text input that switches between a plain `<textarea>` and the `@uiw/react-md-editor` rich Markdown editor based on the `isMarkdownEnabled` prop. Used in the customers Notes section and other Markdown-backed surfaces where the operator may upgrade a plain note to formatted Markdown without rendering both fields simultaneously.

### Migration to `RichEditor`

```diff
- import { SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs/SwitchableMarkdownInput'
- <SwitchableMarkdownInput value={md} onChange={setMd} isMarkdownEnabled={enabled} />
+ import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'
+ <RichEditor value={html} onChange={setHtml} variant="basic" />
```

The storage format changes from Markdown to sanitized HTML — coordinate with the API/persistence layer when migrating.

### Quick usage

```tsx
const [body, setBody] = React.useState<string>('')
const [markdown, setMarkdown] = React.useState(false)

<SwitchableMarkdownInput
  value={body}
  onChange={setBody}
  isMarkdownEnabled={markdown}
  placeholder={t('customers.notes.placeholder', 'Add a note…')}
  rows={4}
  height={260}
/>
```

### Behaviors

- **Switching**: when `isMarkdownEnabled && !disableMarkdown`, renders `@uiw/react-md-editor` via `next/dynamic` (`ssr: false`); otherwise renders a plain `<textarea>`. Switching at runtime preserves `value` content (the parent's controlled state).
- **Dynamic import**: a `LoadingMessage` covers the area while the editor chunk loads. In `NODE_ENV === 'test'` or under Jest, a textarea stub renders in place of the editor (no chunk load).
- **Theme**: respects the resolved theme via `useTheme()` (the editor's `data-color-mode` attribute switches between `dark` and `light`).
- **Remark plugins**: any `remarkPlugins` are merged with the shared Markdown plugin set (`useMarkdownRemarkPlugins`) so preview output matches the rest of the app's Markdown rendering.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string` | — | Controlled body. |
| `onChange` | `(value: string) => void` | — | Emits on every keystroke (`''` when the editor returns `undefined`). |
| `isMarkdownEnabled` | `boolean` | — | Master toggle between editor and textarea. |
| `disableMarkdown` | `boolean` | — | Force textarea mode regardless of the master toggle (use for read-only-Markdown surfaces). |
| `height` | `number` | `220` | Editor pixel height. Ignored in textarea mode. |
| `placeholder` | `string` | — | Textarea placeholder only. |
| `rows` | `number` | `3` | Textarea rows only. |
| `textareaRef` | `React.Ref<HTMLTextAreaElement>` | — | Forwarded ref (textarea mode). |
| `onTextareaInput` | `React.FormEventHandler<HTMLTextAreaElement>` | — | Forwarded `onInput` (textarea mode) — used for auto-grow logic in `customers/components/detail/NotesSection.tsx`. |
| `textareaClassName` | `string` | DS-styled rounded textarea | Override the textarea look. |
| `editorWrapperClassName` | `string` | DS-styled bordered card | Override the editor wrapper. |
| `editorClassName` | `string` | `'w-full'` | Override the editor's inner wrapper. |
| `disabled` | `boolean` | — | Textarea mode only. |
| `remarkPlugins` | `PluggableList` | — | Extra plugins merged with `useMarkdownRemarkPlugins`. |

### MUST rules

- **Do NOT introduce new usages of `SwitchableMarkdownInput`.** Use [`RichEditor`](#richeditor) (sanitized HTML) for rich-text or a plain `Textarea` for plain text. This primitive is `@deprecated` and remains only as a backward-compatibility shim for already-Markdown-backed surfaces.
- When migrating an existing surface to `RichEditor`, coordinate the storage-format change (Markdown → sanitized HTML) with the persistence layer and existing data — a Markdown-to-HTML conversion script may be required.
- For existing consumers (customers Notes etc.) until they migrate: drive `isMarkdownEnabled` from a sibling `Switch` (or a per-user preference) — do not toggle it implicitly based on whether `value` contains Markdown syntax. Forward `textareaRef` when the parent owns auto-grow / scroll-into-view logic.

### Anti-patterns

- Conditionally rendering `<textarea>` vs `<MdEditor>` in the parent → `SwitchableMarkdownInput` already does this and centralizes the loading/test/stub logic.
- Stripping Markdown to plain text on the API boundary because the rich editor occasionally appears → store the format that matches the operator's mode, and switch at render time.

---

## TimeInput

```typescript
import { TimeInput, type TimeInputProps } from '@open-mercato/ui/backend/inputs/TimeInput'
```

Low-level `HH:MM` editor: two `<Input type="number">` cells (hour `0–23`, minute `0–59`) separated by a `:`. No popover, no slot list, no Now/Clear footer. Used as the internal atom inside `DatePicker withTime` and the legacy `TimePicker` shim — **most consumer-facing time fields should use the [`TimePicker`](#timepicker) primitive instead**.

### Quick usage

```tsx
const [hhmm, setHhmm] = React.useState<string>('09:30')

<TimeInput
  value={hhmm}
  onChange={setHhmm}
  minuteStep={5}
/>
```

### Behaviors

- **Keyboard**: `↑` / `↓` on the hour field nudges by 1 with wrap-around (`23 → 0`). On the minute field it nudges by `minuteStep` (default `1`) with wrap-around. The native number-spinner arrows are hidden via `appearance: textfield` so the keyboard is the canonical control surface.
- **Direct typing**: parses to integer, clamps to `[0,23]` / `[0,59]`, and (minute only) snaps to the nearest `minuteStep` multiple.
- **Output**: always emits `HH:MM` zero-padded (`'09:05'`, never `'9:5'`).
- **Width**: each input cell is `w-14` (~`3.5rem`) — keeps the colon visually centred and fits in narrow popovers.

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `string \| null` | — | `'HH:MM'` (24-hour). `null` is treated as `'00:00'`. |
| `onChange` | `(time: string) => void` | — | Always emits `HH:MM`. |
| `disabled` | `boolean` | `false` | — |
| `className` | `string` | — | Applied to the outer flex container. |
| `minuteStep` | `number` | `1` | Step for keyboard nudge and snap on direct entry. |
| `hourLabel` | `string` | `t('ui.timePicker.hourLabel', 'Hour')` | aria-label on the hour input. |
| `minuteLabel` | `string` | `t('ui.timePicker.minuteLabel', 'Minute')` | aria-label on the minute input. |

### MUST rules

- For dialog forms and end-user scheduling UIs, use [`TimePicker`](#timepicker) (slot list, Now action, 12h display) — NOT this primitive.
- When pairing with a date picker, use `DatePicker withTime` rather than composing `DatePicker` + `TimeInput` manually — the primitive already composes them.
- Always pass i18n-resolved `hourLabel` / `minuteLabel` (or let the built-in `useT()` defaults run) — the two number inputs are otherwise unlabelled for screen readers.
- `value` MUST be 24-hour `HH:MM`. Do not feed AM/PM strings or ISO datetimes — convert on the API boundary.

### Anti-patterns

- Two raw `<input type="number">` elements + a colon `<span>` → use `TimeInput` for keyboard parity and zero-padded output.
- `<TimePicker>` inside a tight composite (calendar footer, inline dial) where the popover would re-trigger — that is exactly where `TimeInput` belongs.

---

## Backend shims (DatePicker / DateTimePicker / TimePicker)

The following modules under `packages/ui/src/backend/inputs/` are kept as `@deprecated` re-export shims so existing consumers (CrudForm, example pages, third-party modules) continue to work without code change. **New code MUST import from the primitive path.**

| Legacy import | Replacement | Notes |
|---|---|---|
| `@open-mercato/ui/backend/inputs/DatePicker` | `@open-mercato/ui/primitives/date-picker` (`DatePicker`) | Direct re-export. Default footer is now `'apply-cancel'` (Figma-aligned, applied globally 2026-05-09). Pass `footer="today-clear"` to opt back into the legacy Today/Clear footer. |
| `@open-mercato/ui/backend/inputs/DateTimePicker` | `@open-mercato/ui/primitives/date-picker` (`DatePicker` with `withTime`) | The shim is a thin wrapper: `<DateTimePicker {...props} />` ≡ `<DatePicker {...props} withTime />`. Props type is `Omit<DatePickerProps, 'withTime'>`. |
| `@open-mercato/ui/backend/inputs/TimePicker` | `@open-mercato/ui/primitives/time-picker` (`TimePicker`) | The shim wraps the primitive with a Figma-styled Clock-icon trigger, maps `minuteStep` → `intervalMinutes`, and adapts the legacy `showNowButton` / `showClearButton` flags onto `pinnedTopActions` / `legacyFooterActions`. `showClearButton` default flipped to `false` on 2026-05-11 — the primitive's Cancel already covers most "dismiss" intents. |

### Migration

```diff
- import { DatePicker } from '@open-mercato/ui/backend/inputs/DatePicker'
+ import { DatePicker } from '@open-mercato/ui/primitives/date-picker'

- import { DateTimePicker } from '@open-mercato/ui/backend/inputs/DateTimePicker'
- <DateTimePicker value={value} onChange={setValue} />
+ import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
+ <DatePicker value={value} onChange={setValue} withTime />

- import { TimePicker } from '@open-mercato/ui/backend/inputs/TimePicker'
+ import { TimePicker } from '@open-mercato/ui/primitives/time-picker'
```

### MUST rules

- Do NOT add new features to the shims — every new flag must land on the primitive first. The shim layer is a stable compatibility surface (see `BACKWARD_COMPATIBILITY.md` → Type definitions, Import paths).
- When you touch a file that still imports from `backend/inputs/{DatePicker,DateTimePicker,TimePicker}`, migrate that import to the primitive in the same change — leaving the legacy import in a freshly-touched file is a regression.
- For Markdown docs / generators, the canonical names live next to the primitive path (`packages/ui/src/primitives/date-picker.tsx` / `time-picker.tsx`). The shim files are intentionally thin (~30 LOC) and should not accumulate logic.

### Anti-patterns

- `import { DatePicker } from '@open-mercato/ui/backend/inputs/DatePicker'` in any new file → use the primitive path.
- Wrapping the shim in another wrapper to add features → land the feature on the primitive instead.

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
