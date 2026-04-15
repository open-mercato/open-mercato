# Accessibility: Visual Tokens and Profile Form UI (Draft — DS Direction Pending)

## Status

**Draft — on hold pending Design System direction.**

This spec captures the visual and UI layer that was cut from the omnibus accessibility PR. Ship only after the DS team decides how `--font-scale`, high-contrast token overrides, and reduced-motion rules should integrate with the semantic tokens v2 system.

Tracked as a follow-up to `.ai/specs/2026-04-14-accessibility-wcag-and-preferences.md` (merged). The data model, API, and browser plumbing to load/apply preferences are already in place; this spec adds the CSS token rules and the user-facing form.

## TLDR

**Key Points:**
- Define CSS rules that actually make `--font-scale`, `.high-contrast`, and `.reduce-motion` visible. Without these rules the `AccessibilityProvider` toggles classes on `<html>` to no effect.
- Ship an OSS profile page and an enterprise injection widget so users can edit their preferences. UI form posts through the existing `PUT /api/auth/profile` endpoint already shipped in PR-A.
- Keep all decisions about typography, contrast, and motion at the DS layer — no ad-hoc tokens in individual modules.

**Scope:**
- `apps/mercato/src/app/globals.css` + `packages/create-app/template/src/app/globals.css` — add `html { font-size: calc(1rem * var(--font-scale, 1)); }`; add `html.high-contrast:not(.dark)` + `html.high-contrast.dark` token overrides (oklch values); add `html.reduce-motion` global animation/transition override.
- `AccessibilitySection.tsx` — `CrudForm`-driven form wired via `useGuardedMutation`, reads current values from `useAccessibilityPreferences()`, dispatches `ACCESSIBILITY_PREFERENCES_CHANGED_EVENT` on save for live apply.
- `/backend/profile/accessibility/page.tsx` + `page.meta.ts` — dedicated OSS page, `requireAuth: true`, `navHidden: false`.
- `auth/lib/profile-sections.tsx` — section metadata for rendering the nav label and allowing the page to participate in profile navigation.
- `auth/widgets/injection-table.ts` + `auth/widgets/injection/accessibility-section/` — enterprise `security.profile.sections` widget injection so enterprise users see the form on the security profile as well.
- Enterprise integration test `TC-SEC-009` — verifies the injected widget renders and the skip link behaves on the enterprise profile.
- Relevant i18n keys: `auth.accessibility.*` + `auth.profile.nav.label` (EN/DE/ES/PL).

**Out of scope:**
- Any change to the persisted preference schema, API route, or command. Those shipped in PR-A.

**Placement:** `packages/ui` (globals), `packages/core/src/modules/auth` (form + page + injection), `packages/enterprise` (security-profile test).

## Open Questions for the DS Team

1. **`--font-scale` mechanism** — keep as a simple `calc(1rem * var(--font-scale))` multiplier on `html`, or promote to a token set (e.g. `--font-size-base`, `--font-size-scale`) so semantic tokens can consume it explicitly?
2. **High contrast as theme vs overlay** — treat `.high-contrast` as a second theme variant alongside `.dark`/`:root`, or as an overlay that only overrides specific semantic tokens (background, foreground, border)?
3. **Semantic tokens v2 coexistence** — how should `.high-contrast` interact with the existing status tokens (`--status-error-*`, etc.)? Do status tokens need contrast variants, or are the base overrides enough?
4. **Reduced motion enforcement** — global blanket override (as drafted) is blunt. Does DS prefer per-component opt-in or a tiered approach?
5. **Portal coexistence** — the customer portal has its own shell and theme tokens. Do these preferences need to propagate to the portal (requires a separate customer-side endpoint), or stay strictly in the backoffice?

## Dependency

Requires the PR-A scope (`.ai/specs/2026-04-14-accessibility-wcag-and-preferences.md`) to be merged first. The Provider, data model, API, and event bridge are all in place — this spec only adds the CSS rules and the form.

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

### Form UI

- `AccessibilitySection` built on `CrudForm` with three fields:
  - `highContrast` → toggle
  - `fontSize` → select (S/M/L/XL)
  - `reducedMotion` → toggle (disabled visual when `prefers-reduced-motion: reduce` is detected; label reflects OS fallback)
- Submit path: `useGuardedMutation().runMutation({ operation: 'update', context: 'auth.profile', ... })` → calls `PUT /api/auth/profile` with `{ accessibilityPreferences }` → dispatches `ACCESSIBILITY_PREFERENCES_CHANGED_EVENT` on success so Provider re-applies without reload.

### OSS vs enterprise hosting

- OSS: dedicated page at `/backend/profile/accessibility` (sidebar + profile dropdown entry).
- Enterprise: `security.profile.sections` widget injection in the enterprise security profile. OSS page stays available; enterprise redirect short-circuits the nav entry so there is one entry point per environment.

## Integration Test Coverage

- `TC-SEC-009` — enterprise security profile shows the injected section; save round-trip works; skip link focuses `main#main-content`.
- UI path for the OSS page — form save dispatches live-update event and reflects preference changes in `<html>` classes without a route change.

## Backward Compatibility

- CSS rules are additive to `globals.css`; they only take effect when the corresponding class is present on `<html>`. Default users (no saved preferences, no class toggle) observe no visual change.
- Widget injection spot `security.profile.sections` is already part of the enterprise contract — this spec only adds a new widget, does not change the spot ID.
- New auth i18n keys are additive.

## Changelog

- **2026-04-14** — initial scope baked into the omnibus spec.
- **2026-04-15** — extracted to this standalone draft after reviewer feedback held the visual layer for DS direction.
