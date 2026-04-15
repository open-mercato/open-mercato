# Accessibility: WCAG Markup and User Preferences

## TLDR

**Key Points:**
- Introduce WCAG 2.1 AA fixes to the backoffice chrome (skip-to-content link, ARIA labels, live regions for flash messages) and a dev-only `axe-core` bootstrap.
- Persist per-user accessibility preferences (`highContrast`, `fontSize`, `reducedMotion`) on the `users` row, expose them via `GET`/`PUT /api/auth/profile`, and hydrate them in the browser via `AccessibilityProvider`.
- Visual token rules (CSS for `--font-scale`, `.high-contrast`, `.reduce-motion`) and the user-facing form UI are **out of scope**; they are tracked in a follow-up DS spec so the ownership decision stays with the design system team.
- Voice input for the AI assistant is **out of scope**; tracked in a separate spec pending use-case evaluation.

**Scope:**
- Phase B — WCAG chrome: `AppShell` skip link + `main#main-content` focus target, `FlashMessages` `aria-live`/`role`, `aria-label` on icon-only topbar controls (ProfileDropdown, SettingsButton, UserMenu), dev-only `AxeDevBootstrap` with `@axe-core/react`.
- Phase C (data/API only) — `users.accessibility_preferences` jsonb column, `AccessibilityPreferencesSchema`, `GET`/`PUT /api/auth/profile` additively extended, `auth.users.update` command merges and restores preferences in its undo snapshot.
- Plumbing — `AccessibilityProvider` + `accessibility.ts` hydrate the stored preferences into `document.documentElement` (class toggles + `--font-scale` CSS var) and listen for `ACCESSIBILITY_PREFERENCES_CHANGED_EVENT` for live updates without reload. The provider is forward-compatible: applying the classes is a no-op visually until the DS token spec ships styling for them.

**Out of scope (tracked elsewhere):**
- Visual CSS tokens (`.high-contrast` light/dark, `--font-scale` typography rules, `.reduce-motion` animation overrides) and the profile-level accessibility form UI (`AccessibilitySection`, `/backend/profile/accessibility`, enterprise widget injection) — see `.ai/specs/2026-04-14-accessibility-ds-visual-tokens.md` (draft).
- Voice input for the Command Palette / DockableChat (`VoiceMicButton`, Whisper provider, `/api/ai_assistant/transcribe`) — see `.ai/specs/2026-04-14-ai-assistant-voice-input.md` (draft).

**Placement:** `packages/ui` (chrome + provider), `packages/core/src/modules/auth` (data model + API + command).

## Split from omnibus spec

This spec replaces the merge-blocker parts of `2026-04-14-accessibility-voice-input.md` (deleted). Reviewer feedback on PR #TBD split the omnibus into three scopes:
- **Mergeable now (this spec):** WCAG markup + per-user preference storage + plumbing provider.
- **Hold for DS direction:** visual token layer and form UI — see the DS draft spec.
- **Separate evaluation:** voice input — see the voice draft spec.

The analysis document `.ai/specs/analysis/ANALYSIS-2026-04-14-accessibility-voice-input.md` is removed; its backward-compatibility findings relevant to this scope are merged into the BC section below.

## Problem Statement

1. Keyboard-only users cannot skip past the sidebar to reach page content — no skip link exists and `main` is not focusable.
2. Screen readers receive no announcement when a flash message appears — `FlashMessages` rendered without `aria-live` or `role="alert"`/`role="status"`.
3. Icon-only topbar controls (profile dropdown, settings, user menu) lack accessible names; assistive tech announces them as bare buttons.
4. Accessibility preferences that users already expect (contrast / text scale / motion) have no persistence surface; any future rendering work has nowhere to read them from.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Store preferences on `users.accessibility_preferences` (jsonb, nullable) rather than on a per-tenant preference row | Accessibility preferences travel with the user across every tenant/organization — they are not scoped like sidebar preferences (`user_sidebar_preferences`). JSON column on `users` mirrors other user-scoped globals. |
| Extend `PUT /api/auth/profile` additively (`{ accessibilityPreferences? }`) | Existing endpoint already owns self-service profile updates. A parallel endpoint would fork the audit trail and duplicate session-refresh logic. |
| Conditional JWT refresh on `PUT /api/auth/profile` — only on email/password change | Saving a preference must not log the user out of other sessions. Refresh only when credentials change; preserve the original `sid`. |
| `AccessibilityProvider` applies DOM classes/CSS vars regardless of whether DS tokens exist | Plumbing ships independently of the visual layer so the DS team can style the classes later without a coordinated release. The apply step is a harmless no-op without the token CSS. |
| Dev-only `@axe-core/react` bootstrap (`NODE_ENV !== 'production'`) | Catches axe violations during local development without shipping a runtime dependency to production bundles. |

### Architecture

```
packages/ui/src/backend/
├── AppShell.tsx                 # skip link + main#main-content + renders Provider + AxeDevBootstrap
├── FlashMessages.tsx            # role="alert|status" + aria-live
├── ProfileDropdown.tsx          # aria-label on icon-only triggers
├── SettingsButton.tsx           # aria-label
├── UserMenu.tsx                 # aria-label
├── AccessibilityProvider.tsx    # useSyncExternalStore + apply-on-change
├── accessibility.ts             # applyAccessibilityPreferences + FONT_SCALE + event id
└── devtools/AxeDevBootstrap.tsx # lazy-loads @axe-core/react in dev only

packages/core/src/modules/auth/
├── data/entities.ts             # User.accessibilityPreferences
├── data/validators.ts           # AccessibilityPreferencesSchema
├── api/profile/route.ts         # GET returns prefs; PUT accepts prefs; conditional JWT refresh
├── commands/users.ts            # merge + undo snapshot
└── migrations/Migration20260414130740.ts
```

### Phase B — WCAG markup

- **Skip link** in `AppShellBody`: renders an `<a>` pointing at `#main-content`, visually hidden until focused (`sr-only focus-visible:not-sr-only`), handled `onClick` to scroll + focus the target. Label uses `common.skip_to_content` i18n key.
- **Main focus target**: `<main id="main-content" tabIndex={-1}>` so the skip link can focus it.
- **FlashMessages**: container gets `role="alert"` for errors / `role="status"` for info/success and `aria-live="assertive"`/`"polite"` accordingly.
- **Topbar icon buttons**: `aria-label` sourced from existing translation keys where possible.
- **AxeDevBootstrap**: imports `@axe-core/react` only when `process.env.NODE_ENV !== 'production'`, attaches on mount, no-op otherwise.

### Phase C — Data model + API (preference storage only)

- **Migration `Migration20260414130740`** adds `accessibility_preferences jsonb null` to `users`.
- **`AccessibilityPreferencesSchema`** (zod):
  ```ts
  z.object({
    highContrast: z.boolean().optional(),
    fontSize: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
    reducedMotion: z.boolean().optional(),
  }).strict()
  ```
- **`GET /api/auth/profile`** response is additive: `{ email, roles, accessibilityPreferences: AccessibilityPreferences | null }`.
- **`PUT /api/auth/profile`** accepts optional `accessibilityPreferences`. JWT refresh is gated:
  ```ts
  if (parsed.data.email !== undefined || parsed.data.password !== undefined) {
    // reissue token preserving `sid`
  }
  ```
- **`auth.users.update`** command merges `accessibilityPreferences` into the entity, includes both `before` and `after` in the undo snapshot, and is covered by a dedicated unit test.
- **i18n**: extends `auth.profile.form.errors.emailOrPasswordRequired` to mention accessibility settings (EN/DE/ES/PL) so the OSS error message reflects the new optional payload.

### Plumbing — AccessibilityProvider

- Module-level store backed by `useSyncExternalStore`. `ensureAccessibilityPreferencesLoaded()` memoizes the in-flight `/api/auth/profile` request so the Provider (mounted in `AppShell`) does not duplicate fetches across components.
- On success, calls `applyAccessibilityPreferences(prefs)` — sets `--font-scale` via `FONT_SCALE` lookup and toggles `.high-contrast`/`.reduce-motion` on `<html>`.
- On failure (401/403/network), sets `error` state and — critically — **nulls `loadPromise`** so a later call (after sign-in, route change, etc.) can retry. This is the behavior fix required by reviewer feedback.
- Subscribes to `ACCESSIBILITY_PREFERENCES_CHANGED_EVENT` (window CustomEvent) and re-applies without a reload, enabling the follow-up DS spec's form UI to dispatch updates on save.
- Exposes `useAccessibilityPreferences()` hook and `__resetAccessibilityStoreForTests()` for Jest isolation.

## Implementation Plan

1. **WCAG chrome** — edit `AppShell`, `FlashMessages`, `ProfileDropdown`, `SettingsButton`, `UserMenu`; add `AxeDevBootstrap`; add `@axe-core/react` devDep; seed `common.skip_to_content` translations.
2. **Provider + accessibility.ts** — module-level store, event bridge, apply helper.
3. **Auth data model** — entity column, schema, migration, regenerated snapshot.
4. **Profile API + command** — `GET`/`PUT` extension, command merge/undo, tests.
5. **Retry-after-failure fix** — null `loadPromise` in `.catch()`, regression test covers two consecutive renders (first fails, second succeeds).
6. **Spec authoring** — this file + DS draft + voice draft; delete omnibus + analysis.

## Integration Test Coverage

| Test | Path |
|------|------|
| Self-service profile persists accessibility preferences through `GET` + `PUT /api/auth/profile` | `packages/core/src/modules/auth/__integration__/TC-AUTH-027.spec.ts` |

UI-level integration tests that depend on the form page (`/backend/profile/accessibility`) move to the DS spec's coverage along with the page.

## Unit Test Coverage

- `packages/ui/src/backend/__tests__/AccessibilityProvider.test.tsx` — hydrate from profile, keep defaults on failure, retry after failure (new), react to event without reload, apply system reduced motion.
- `packages/ui/src/backend/__tests__/AppShell.test.tsx` — skip link renders and focuses `main#main-content`.
- `packages/ui/src/backend/__tests__/FlashMessages.test.tsx` — `role`/`aria-live` wired per variant.
- `packages/ui/src/backend/__tests__/TopbarAccessibility.test.tsx` — icon-only controls expose accessible names.
- `packages/core/src/modules/auth/api/__tests__/profile.route.test.ts` — additive read/write, conditional JWT refresh.
- `packages/core/src/modules/auth/commands/__tests__/users.accessibility.test.ts` — merge + undo snapshot round-trip.

## Backward Compatibility

Assessed against the 13 contract surfaces in `BACKWARD_COMPATIBILITY.md`.

| # | Surface | Assessment |
|---|---------|------------|
| 1 | Auto-discovery conventions | Unchanged. |
| 2 | Type definitions | New optional `accessibilityPreferences` field on User and profile response — additive. |
| 3 | Function signatures | `auth.users.update` command payload gains optional field — additive. |
| 4 | Import paths | No existing path moves. New exports under `@open-mercato/ui/backend/AccessibilityProvider` and `@open-mercato/ui/backend/accessibility`. |
| 5 | Event IDs | New window CustomEvent name `accessibility-preferences-changed`; no existing event renamed. |
| 6 | Widget injection spot IDs | Unchanged in this scope (enterprise spot reuse tracked with the DS spec). |
| 7 | API route URLs | `GET`/`PUT /api/auth/profile` stay at the same path; response/payload shape is additive. Existing fields (`ok`, `email`, `roles`) preserved. |
| 8 | Database schema | New nullable `users.accessibility_preferences jsonb`; no existing column altered. |
| 9 | DI service names | Unchanged. |
| 10 | ACL feature IDs | Unchanged (no new features introduced in this scope). |
| 11 | Notification type IDs | Unchanged. |
| 12 | CLI commands | Unchanged. |
| 13 | Generated file contracts | Unchanged. |

**Non-regression required before merge:**
- `PUT /api/auth/profile` without any field → still rejected; with only `email` → still refreshes JWT preserving `sid`; with only `password` → still refreshes JWT preserving `sid`; with only `accessibilityPreferences` → does NOT refresh JWT.
- `GET /api/auth/profile` for a user who never saved preferences → `accessibilityPreferences: null`, all existing fields unchanged.
- Undoing `auth.users.update` after a preferences-only save restores `null` (or the prior value), not the new value.

## Changelog

- **2026-04-14 (Rev 11)** — omnibus spec authored (`2026-04-14-accessibility-voice-input.md`, now removed).
- **2026-04-15 (split)** — omnibus narrowed to this spec (PR-A scope) per reviewer feedback; visual tokens and voice input extracted to companion draft specs; analysis doc removed after folding BC findings into this file.
