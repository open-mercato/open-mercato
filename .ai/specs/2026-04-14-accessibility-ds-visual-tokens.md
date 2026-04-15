# Accessibility: Visual Tokens (Draft — DS Direction Pending)

## Status

**Draft — on hold pending Design System direction.**

This spec captures only the CSS-level visual layer held out of the PR-A scope. Ship after the DS team decides how `--font-scale`, high-contrast token overrides, and reduced-motion rules should integrate with the semantic tokens v2 system.

Tracked as a follow-up to `.ai/specs/2026-04-14-accessibility-wcag-and-preferences.md`. The preference schema, API, command, Provider, form UI, profile page, widget injection, and nav metadata are all already shipped in PR-A; the only remaining piece is the CSS that responds to the root classes the Provider already applies.

## TLDR

**Key Points:**
- Define CSS rules that make `--font-scale`, `.high-contrast`, and `.reduce-motion` visually meaningful. Without these rules the `AccessibilityProvider` toggles classes on `<html>` to no visible effect.
- Keep all decisions about typography, contrast, and motion at the DS layer — no ad-hoc tokens in individual modules.
- Ship the enterprise visual-rendering integration test alongside the CSS so the coverage matches the shipped behavior.

**Scope:**
- `apps/mercato/src/app/globals.css` + `packages/create-app/template/src/app/globals.css` — add `html { font-size: calc(1rem * var(--font-scale, 1)); }`; add `html.high-contrast:not(.dark)` + `html.high-contrast.dark` token overrides (oklch values); add `html.reduce-motion` global animation/transition override.
- Enterprise integration test `TC-SEC-009` — verifies the injected section renders through `security.profile.sections` and that the high-contrast root class actually flips visual tokens in the enterprise security profile.

**Out of scope (already shipped in PR-A):**
- Preference schema, `users.accessibility_preferences` column, `GET`/`PUT /api/auth/profile`, `auth.users.update` command, `AccessibilityProvider`, event bridge, profile page `/backend/profile/accessibility`, `AccessibilitySection` form, widget injection into `security.profile.sections`, full `auth.accessibility.*` + `auth.profile.nav.label` i18n keys, OSS UI test in `TC-AUTH-027`.

**Placement:** `apps/mercato` + `packages/create-app/template` (globals.css), `packages/enterprise` (security-profile integration test).

## Open Questions for the DS Team

1. **`--font-scale` mechanism** — keep as a simple `calc(1rem * var(--font-scale))` multiplier on `html`, or promote to a token set (e.g. `--font-size-base`, `--font-size-scale`) so semantic tokens can consume it explicitly?
2. **High contrast as theme vs overlay** — treat `.high-contrast` as a second theme variant alongside `.dark`/`:root`, or as an overlay that only overrides specific semantic tokens (background, foreground, border)?
3. **Semantic tokens v2 coexistence** — how should `.high-contrast` interact with the existing status tokens (`--status-error-*`, etc.)? Do status tokens need contrast variants, or are the base overrides enough?
4. **Reduced motion enforcement** — global blanket override (as drafted) is blunt. Does DS prefer per-component opt-in or a tiered approach?
5. **Portal coexistence** — the customer portal has its own shell and theme tokens. Do these preferences need to propagate to the portal (requires a separate customer-side endpoint), or stay strictly in the backoffice?

## Dependency

Requires the PR-A scope (`.ai/specs/2026-04-14-accessibility-wcag-and-preferences.md`) to be merged first. All plumbing is in place — the form saves preferences, the Provider toggles root classes — the only missing piece is the CSS rules responding to those classes.

## Proposed Solution (Reference — adjust after DS review)

### CSS rules

```css
html { font-size: calc(1rem * var(--font-scale, 1)); }

html.high-contrast:not(.dark) { /* oklch token overrides for light high-contrast */ }
html.high-contrast.dark       { /* oklch token overrides for dark high-contrast */ }

html.reduce-motion *,
html.reduce-motion *::before,
html.reduce-motion *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  transition-duration: 0.01ms !important;
}
```

Actual token values and scope TBD by DS review.

## Integration Test Coverage

- `TC-SEC-009` — enterprise security profile shows the injected section, save round-trip works, and the `.high-contrast` class actually changes visible tokens (background/foreground contrast measurement).

## Backward Compatibility

- CSS rules are additive to `globals.css`; they only take effect when the corresponding class is present on `<html>`. Default users (no saved preferences, no class toggle) observe no visual change.
- No new dependencies, no schema changes, no route changes.

## Changelog

- **2026-04-14** — initial scope baked into the omnibus spec.
- **2026-04-15** — extracted to this standalone draft after reviewer feedback held the visual layer for DS direction.
- **2026-04-15 (narrowed)** — form UI, page, widget injection, nav metadata, and `auth.accessibility.*` i18n moved back into PR-A per reviewer's "possibly backend/profile plumbing without the visual token layer" note. This spec now covers only the CSS rules + the enterprise visual-rendering test.
