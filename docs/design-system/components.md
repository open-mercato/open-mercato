# Part 4 — Component MVP

> List of components to standardize with priorities and statuses. Methodology + analysis of 22 components.

---

## Methodology

Components evaluated on the following criteria:
- **Priority**: how important for system consistency
- **Reuse**: how frequently used in the codebase
- **Complexity risk**: risk of the component becoming overly complex
- **Hackathon MVP**: whether it can be done in 2-3 days

---

## 4.1 Button

| | |
|---|---|
| **Category** | Actions |
| **Priority** | P0 — critical |
| **Rationale** | Most frequently used interactive element. Already exists and works well. |
| **When to use** | Any user action: submit, cancel, delete, create, navigate |
| **When NOT to use** | Navigation to another page (use Link). Display-only text. |
| **Anatomy** | `[icon?] [label] [icon?]` |
| **Variants** | default, destructive, outline, secondary, ghost, muted, link |
| **Sizes** | sm (h-8), default (h-9), lg (h-10), icon (size-9) |
| **States** | default, hover, focus, active, disabled, loading |
| **Accessibility** | `aria-label` required if icon-only. `disabled` prevents interaction. Focus ring visible. |
| **Dependencies** | color tokens, typography, spacing, border-radius, focus ring |
| **Complexity risk** | Low — already well-implemented with CVA |
| **Status** | **EXISTS** — `packages/ui/src/primitives/button.tsx` |
| **Hackathon** | NO — already done, documentation only if needed |

---

## 4.2 Icon Button

| | |
|---|---|
| **Category** | Actions |
| **Priority** | P0 |
| **Rationale** | Used in row actions, close buttons, toolbars. |
| **When to use** | Action represented by an icon (close, delete, edit, more) |
| **When NOT to use** | If the action requires a label (use Button). If it is decorative. |
| **Anatomy** | `[icon]` |
| **Variants** | outline, ghost |
| **Sizes** | xs (size-6), sm (size-7), default (size-8), lg (size-9) |
| **States** | default, hover, focus, active, disabled |
| **Accessibility** | `aria-label` **REQUIRED** (TypeScript enforcement) |
| **Dependencies** | icon system, color tokens, border-radius |
| **Complexity risk** | Low |
| **Status** | **EXISTS** — `packages/ui/src/primitives/icon-button.tsx` |
| **Hackathon** | NO — already done, needs TypeScript enforcement on aria-label |

---

## 4.3 Link

| | |
|---|---|
| **Category** | Navigation |
| **Priority** | P1 |
| **Rationale** | Navigation between pages. Next.js Link is used directly. |
| **When to use** | Navigation to another page, external link |
| **When NOT to use** | In-place action (use Button) |
| **Anatomy** | `[icon?] [text] [external-icon?]` |
| **Variants** | default (underline), subtle (no underline), nav (sidebar item) |
| **States** | default, hover, focus, active, visited |
| **Accessibility** | External links: `target="_blank" rel="noopener"` + visual indicator |
| **Dependencies** | typography, color tokens |
| **Complexity risk** | Low |
| **Status** | Partially exists (Button variant="link"), no dedicated component |
| **Hackathon** | NO — low priority, Button variant="link" is sufficient |

---

## 4.4 Input

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P0 |
| **Rationale** | Fundamental form element |
| **When to use** | Single-line text: name, email, url, number, password |
| **When NOT to use** | Multi-line text (Textarea), selection from a list (Select) |
| **Anatomy** | `[prefix?] [input] [suffix?]` |
| **Variants** | default, error |
| **States** | default, focus, disabled, readonly, error |
| **Accessibility** | Associated `<label>` via htmlFor. `aria-invalid` on error. `aria-describedby` for description/error. |
| **Dependencies** | color tokens (border, focus ring), typography, spacing, border-radius |
| **Complexity risk** | Low |
| **Status** | **EXISTS** — `packages/ui/src/primitives/input.tsx` |
| **Hackathon** | NO — already done |

---

## 4.5 Textarea

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/textarea.tsx` |
| **Hackathon** | NO |

---

## 4.6 Select / Combobox

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P0 |
| **Status** | **EXISTS** — `ComboboxInput` in `packages/ui/src/backend/inputs/` |
| **Hackathon** | NO |

---

## 4.7 Checkbox

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/checkbox.tsx` |
| **Hackathon** | NO |

---

## 4.8 Switch

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/switch.tsx` |
| **Hackathon** | NO |

---

## 4.9 Form Field Wrapper

| | |
|---|---|
| **Category** | Forms |
| **Priority** | **P0 — CRITICAL, DOES NOT EXIST** |
| **Rationale** | No consistent wrapper for label + input + description + error. Each module implements this manually. |
| **When to use** | Any form field outside of CrudForm |
| **When NOT to use** | Inside CrudForm (has built-in wrapper) |
| **Anatomy** | `[label] [required-indicator?] → [input (slot)] → [description?] → [error-message?]` |
| **Variants** | default, horizontal (label beside input) |
| **States** | default, error, disabled |
| **Accessibility** | Auto-generated `id` and `htmlFor`. `aria-describedby` linking description/error. `aria-invalid` on error. `aria-required` on required. |
| **Dependencies** | typography (label style), color tokens (error), spacing |
| **Complexity risk** | Low — this is a wrapper, not logic |
| **Status** | **DOES NOT EXIST** — `<Label>` exists but no wrapper composing label+input+error |
| **Hackathon** | **YES** — priority component to create |

---

## 4.10 Card

| | |
|---|---|
| **Category** | Layout |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/card.tsx` (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter) |
| **Problem** | Portal has a separate `PortalCard` with different padding/radius. Needs unification. |
| **Hackathon** | NO — exists, requires unification with PortalCard |

---

## 4.11 Badge

| | |
|---|---|
| **Category** | Data Display |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/badge.tsx` |
| **Problem** | Variants (default, secondary, destructive, outline, muted) do not cover status colors. Modules use hardcoded colors on badges instead of variants. |
| **Hackathon** | YES — add status variants (success, warning, info) based on semantic tokens |

---

## 4.12 Alert / Notice (UNIFICATION)

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | **P0 — CRITICAL** |
| **Rationale** | Two components (Alert + Notice) doing the same thing. 4 different color palettes. |
| **When to use** | Inline page messages: error, success, warning, info |
| **When NOT to use** | Temporary feedback (use Flash/Toast). Action confirmation (use ConfirmDialog). |
| **Anatomy** | `[icon] [title?] [description] [action?] [close?]` |
| **Variants** | error, success, warning, info, default |
| **States** | default, dismissible |
| **Accessibility** | `role="alert"` for error/warning. `aria-live="polite"` for info/success. |
| **Dependencies** | semantic color tokens (CRITICAL), typography, spacing, border-radius, icon system |
| **Complexity risk** | Medium — need to migrate Notice users to the unified component |
| **Status** | Alert exists with 5 variants, Notice exists with 3 variants, ErrorNotice is a wrapper |
| **Hackathon** | **YES** — unify into a single component based on semantic tokens |

---

## 4.13 Toast / Flash Message

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | P1 |
| **Status** | **EXISTS** — `FlashMessages` with `flash()` API |
| **Problem** | Colors are hardcoded (emerald-600, red-600). Should use semantic tokens. |
| **Hackathon** | YES — migrate to semantic color tokens |

---

## 4.14 Modal / Dialog

| | |
|---|---|
| **Category** | Overlay |
| **Priority** | P0 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/dialog.tsx` (Radix-based) + `useConfirmDialog` |
| **Hackathon** | NO — works well |

---

## 4.15 Dropdown Menu

| | |
|---|---|
| **Category** | Navigation / Actions |
| **Priority** | P1 |
| **Status** | **EXISTS** — `RowActions` uses dropdown, `ProfileDropdown` has custom dropdown |
| **Hackathon** | NO |

---

## 4.16 Tabs

| | |
|---|---|
| **Category** | Navigation |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/tabs.tsx` |
| **Hackathon** | NO |

---

## 4.17 Table

| | |
|---|---|
| **Category** | Data Display |
| **Priority** | P0 |
| **Status** | **EXISTS** — `DataTable` (1000+ lines, feature-rich) + primitives `table.tsx` |
| **Hackathon** | NO — already very feature-rich |

---

## 4.18 Empty State

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | **P0 — CRITICAL** |
| **Status** | **EXISTS** but 79% of pages do not use it |
| **Hackathon** | **YES** — documentation + enforcement guidelines, not a new component |

---

## 4.19 Loader / Skeleton

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | P1 |
| **Status** | **EXISTS** — `Spinner`, `LoadingMessage`. No Skeleton. |
| **Hackathon** | NO — Spinner is sufficient for now |

---

## 4.20 Page Header / Section Header

| | |
|---|---|
| **Category** | Layout |
| **Priority** | P1 |
| **Status** | **EXISTS** — `PageHeader` in `Page.tsx`, `FormHeader` in `forms/` |
| **Problem** | No shared `SectionHeader` — 15+ sections implement their own header |
| **Hackathon** | **YES** — `SectionHeader` component (title + action + collapse) |

---

## 4.21 Pagination

| | |
|---|---|
| **Category** | Navigation |
| **Priority** | P1 |
| **Status** | **EXISTS** — built into DataTable |
| **Hackathon** | NO |

---

## 4.22 Status Badge (NEW)

| | |
|---|---|
| **Category** | Data Display |
| **Priority** | **P0 — CRITICAL, DOES NOT EXIST AS SEPARATE COMPONENT** |
| **Rationale** | Every module hardcodes status colors. Need a component mapping status to color via semantic tokens. |
| **When to use** | Displaying status: active/inactive, draft/published, paid/unpaid, open/closed |
| **Anatomy** | `[dot?] [label]` |
| **Variants** | success, warning, error, info, neutral, custom (color prop) |
| **Hackathon** | **YES** — based on Badge + semantic color tokens |

---

## Implementation priorities

### Must Have — Hackathon (days 1-3)

| # | Component | Type | Rationale |
|---|-----------|------|-----------|
| 1 | Semantic Color Tokens | Foundation | Eliminates 372 hardcoded colors |
| 2 | Alert (unified) | Refactor | Replaces Notice + Alert + ErrorNotice |
| 3 | FormField Wrapper | New | Missing wrapper for label+input+error |
| 4 | Status Badge | New | Eliminates hardcoded status colors |
| 5 | Badge (status variants) | Refactor | Add success/warning/info variants |
| 6 | Flash Messages | Refactor | Migrate to semantic tokens |
| 7 | SectionHeader | New | Eliminates 15+ duplicates |
| 8 | Empty State guidelines | Docs | Enforcement across 79% of pages |

### Should Have — post-hackathon (week 1-2)

| # | Component | Rationale |
|---|-----------|-----------|
| 9 | Typography scale | Tailwind config + documentation |
| 10 | Icon system standardization | lucide-react everywhere |
| 11 | Card unification | Card + PortalCard merge |
| 12 | Skeleton loader | Progressive loading |
| 13 | Accessibility audit pass | 370+ missing aria-labels |

### Nice to Have — later

| # | Component | Rationale |
|---|-----------|-----------|
| 14 | Command palette | Navigation improvement |
| 15 | Breadcrumb component | Extraction from AppShell |
| 16 | Content style guide | Tone, microcopy |
| 17 | Motion tokens | Animation standardization |
| 18 | Responsive DataTable | Mobile view |

---

---

## See also

- [Component API Proposals](./component-apis.md) — detailed APIs (props, variants, examples)
- [Component Specs](./component-specs.md) — specs for Button, Card, Dialog, Tooltip + quick reference
- [Audit](./audit.md) — audit data driving the prioritization
- [Foundations](./foundations.md) — tokens used by components
