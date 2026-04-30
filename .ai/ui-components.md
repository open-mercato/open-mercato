# UI Components Reference

Detailed variant tables, size matrices, props, examples, and MUST rules for every `@open-mercato/ui` primitive. Quick reference (one-line per component) is in [`packages/ui/AGENTS.md`](../packages/ui/AGENTS.md). Foundation rules (color tokens, typography, spacing, decision trees) live in [`.ai/ds-rules.md`](./ds-rules.md).

## Table of Contents

- [Button](#button)
- [IconButton](#iconbutton)
- [LinkButton](#linkbutton)
- [SocialButton](#socialbutton)
- [FancyButton](#fancybutton)
- [Checkbox / CheckboxField](#checkbox--checkboxfield)
- [Avatar / AvatarStack](#avatar--avatarstack)
- [Kbd / KbdShortcut](#kbd--kbdshortcut)
- [Tag](#tag)
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

### MUST rules

- NEVER hardcode colors on `Tag` — use variants only.
- Use `dot` for status-like categories (Customer, Hot); omit for purely descriptive labels.
- For "Manage tags" / add-tag affordances: use `Button variant="ghost"` or dashed outline — NOT `Tag`.
- `brand` variant is for user-saved views and renewal/custom category tags only.

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
