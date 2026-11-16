# Honest cookie notice and a consent gate

> **Program:** package E5 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Whether the forms runner loads a captcha script in the browser, where Leaflet's own assets come from, and whether the browser telemetry component writes browser storage were not checked.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Every page shows a bar that says "We use essential cookies" with two buttons, "Accept cookies" and "Dismiss". Both do the same thing: they hide the bar. Nothing reads which one was pressed, and the product sets only cookies it needs to work, for which no consent is required. So the bar asks for a consent it does not need and would not honour. And an operator who adds analytics has nothing to ask consent with. **Proposed (future):** in two steps that ship separately. First, the bar becomes a plain notice with one button. Second, the application can declare a non-essential category; the same bar then offers Accept and Reject with equal weight, remembers the answer, and a small gate component keeps anything in that category from rendering until the answer is yes. The product itself declares no non-essential category.

**Not in this spec:** gating the built-in browser telemetry, which is left as it is and marked for a person's decision; tenant-owned privacy pages (package E1); map tiles (package F3); proof of consent on a server; consent for marketing email (package E2); the attributes of the thirteen places that write cookies from the browser.

## 📝 Overview

> **Market reference.** The French and Italian regulators' guidance, and consent tools such as Klaro and Cookiebot, agree on four points: no banner is required for strictly necessary cookies; refusing must be as easy as accepting; nothing non-essential may load before a yes; and the choice must be easy to change later. Adopted: all four. Rejected: a full consent-management platform with vendor lists; this is a gate and a banner, not a product.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | With only essential cookies | A notice with one "OK" button, shown once | ⚠ NEEDS HUMAN CONFIRMATION. Showing nothing is also lawful, and some will prefer it. A notice keeps the existing acknowledgement cookie that the test helpers pre-set. |
| 2 | Built-in browser telemetry | Not gated; nothing changes | ⚠ NEEDS HUMAN CONFIRMATION. It is off by default, same-origin, and mounted only for signed-in staff. Consent from employees is a weak basis, and regulators exempt some first-party measurement. Gating it would silently cut the data of operators who use it. The gate is there if a person decides otherwise. |
| 3 | Where non-essential categories are declared | One app-owned file under `src/lib`, read on the server and handed to the client as a prop | The list can depend on server-only settings. `src/lib` is already mirrored into the template by the sync tool; a new top-level file would not be. |
| 4 | Where the choice is stored | A first-party cookie holding the answer and its revision per category | No server call; works for visitors with no account. It is not proof of consent, and the spec says so. |
| 5 | The existing `user_consents` table | Not used | It holds one current row per signed-in staff user and consent type, with no visitor key and no write route. |
| 6 | Stripe's script on a payment page | Essential | It loads only when a payment is being made and is needed to make it. |
| 7 | Asking again | Only for a category the stored answer does not cover, or whose declared revision is newer | A hash of the whole list would ask everyone again when a category is removed, and would miss a category whose purpose changed. |

## 📝 Problem Statement

- **The bar.** `apps/mercato/src/components/GlobalNoticeBars.tsx`, identical in the create-app template, is mounted for every page (`AppProviders.tsx:38`) unless the server hides it (`app/layout.tsx:35`). It says the product uses essential cookies and links to `/privacy` (`:106`). "Dismiss" writes `om_cookie_notice_ack=dismissed` and "Accept cookies" writes `om_cookie_notice_ack=ack` (`:47-55`). The only reader checks that the cookie exists, after mount (`:30-37`).
- **What the product sets.** Sign-in and session cookies for staff and portal users, the language, the selected tenant and organization, a few interface preferences and acknowledgements, and short-lived cookies for payment links and single sign-on. All first-party. No analytics cookie exists.
- **What the browser loads from elsewhere.** Map tiles from OpenStreetMap when a map is shown; Stripe's script on payment pages when a key is configured. No analytics script, remote font or embedded player was found.
- **Built-in browser telemetry** is enabled by server-only settings (`packages/telemetry/src/browser/server.ts:95-126`), is mounted in the backend layout, starts once and has no way to stop (`BrowserTelemetry.tsx:184-191`). A test opts into it by cookie.
- **Client files cannot read server settings.** `ClientBootstrap.tsx:21-34` documents the trap; the server resolves such values and passes them down, as it does for whether the bars are shown.
- **No place to hook in.** The root layout has no injection point, and the public bootstrap profile loads no registries (`ClientBootstrap.tsx:166-167`).
- **No footer is shared by every surface.** The sign-in footer renders only on the login and onboarding pages (`AuthFooter.tsx:10-13`); the backend's footer is inside `AppShell` (`packages/ui/src/backend/AppShell.tsx:1639`).
- **Tests depend on the cookie name.** The shared integration helper pre-sets `om_cookie_notice_ack` and `om_demo_notice_ack` (`packages/core/src/helpers/integration/auth.ts:70-76`), as do many specs. A test can turn the bars on for itself with a per-request cookie (`packages/cli/src/lib/testing/integration.ts:2232-2236`).
- **The language cookie** is set by the server with no `SameSite` or `Secure` (`auth/api/locale/route.ts:66, 86`).

## 📝 Proposed Solution

### Phase 1 — An honest notice

The bar shows one sentence, the link to `/privacy`, and one "OK" button. It writes the same cookie as today. The language cookie gets `SameSite=Lax` and, in production, `Secure`.

### Phase 2 — The gate

**Declaring.** `apps/mercato/src/lib/consent.ts`, mirrored in the template, exports a function the root layout calls on the server. It returns the categories: an id, title and description keys, whether it is essential, and a revision number. The shipped function returns only `essential`. The layout passes the list to `AppProviders` as a prop.

**The bar's second state.** When the list has a non-essential category that the stored answer does not cover at its current revision, the bar shows the same sentence with "Accept" and "Reject" side by side in the same style, and "Choose", which opens the categories with a switch each. The acknowledgement cookie alone does not hide this state.

**The primitives**, exported from `packages/ui`:

- `ConsentProvider`, given the list; it reads the cookie after mount and writes it.
- `useConsent(category)`, which returns `granted`, `denied` or `unset`.
- `ConsentGate`, which renders its children only when the category is granted. Before mount, and for `unset`, it renders its placeholder or nothing.
- `ConsentSettingsLink`, which renders a "Cookie settings" link only when a non-essential category exists.

**Changing one's mind.** `ConsentSettingsLink` is placed in the sign-in footer, the backend shell's footer and the portal shell's footer. Saving a change reloads the page, because a component that has already started — a script, a telemetry client — cannot be relied on to stop.

**Using it.** An operator who adds analytics adds a category to `consent.ts` and wraps the script in the gate. The docs carry that recipe.

### Design decisions

| Decision | Rationale |
|---|---|
| The acknowledgement cookie keeps its name and meaning | The integration helper and many tests pre-set it. |
| Choices live in a separate cookie | An acknowledgement of a notice is not an answer to a question. |
| The list is resolved on the server | See assumption 3. |
| Reject is a button of the same size as Accept | Refusing must be as easy as accepting. |
| The gate is a component, not a script blocker | It works with server rendering and needs no rewriting of tags. |
| A reload on change | The only way to be sure something stopped. |
| A revision per category | See assumption 7. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Remove the bar | See assumption 1. |
| Keep both buttons and make them differ | With only essential cookies there is nothing for them to differ about. |
| Gate the built-in telemetry now | See assumption 2. |
| A module convention file for categories | A new frozen contract for something no first-party module needs. |
| Store choices in `user_consents` | See assumption 5. |
| Vary the content security policy per visitor | A header cannot depend on a cookie without disabling caching for every page. |

### Known limits

- A cookie records a choice; it does not prove one. An operator who must demonstrate consent needs a server-side record, which this spec does not provide.
- Nothing forces an operator to use the gate.
- The link on the bar goes to `/privacy`, which names the vendor until package E1 lands; the list of cookies is on the deployment docs page.

## 📝 Delta

### Capability: cookie-notice-and-consent

#### MODIFIED Requirement: Cookie notice
The system SHALL show a notice that matches what it does: an acknowledgement when only essential cookies are used, and a choice with equally prominent accept and reject when a non-essential category is declared.

##### Scenario: Essential only
- WHEN a visitor without the acknowledgement cookie opens a page of the shipped application
- THEN the bar shows one button, and pressing it hides the bar on later pages

##### Scenario: Existing acknowledgement
- WHEN a visitor already has the acknowledgement cookie and only essential cookies are declared
- THEN no bar is shown

##### Scenario: A non-essential category
- WHEN the application declares one
- THEN the bar shows Accept and Reject with the same styling, and the acknowledgement cookie alone does not hide it

Frozen by: `apps/mercato/src/components/__tests__/GlobalNoticeBars.characterization.test.tsx`

#### ADDED Requirement: Consent gate
The system SHALL NOT render anything wrapped in the gate until the visitor has accepted its category.

##### Scenario: Before an answer
- WHEN no choice has been made
- THEN gated content is not rendered

##### Scenario: Reject
- WHEN the visitor rejects
- THEN gated content is not rendered on this or later pages, and the bar does not return

##### Scenario: Change of mind
- WHEN the visitor opens "Cookie settings", switches a category off and saves
- THEN the page reloads and gated content in it is not rendered

##### Scenario: A new category
- WHEN the declared list gains a category
- THEN a visitor who answered the old list is asked about it, and their earlier answers stand

##### Scenario: A changed purpose
- WHEN a category's revision is raised
- THEN a visitor who accepted the earlier revision is asked again, and it is treated as unset until they answer

## 📝 Architecture

- **`packages/ui/src/frontend/consent/`**: provider, hook, gate, settings link, the cookie codec. Client files; no dependency.
- **`apps/mercato/src/lib/consent.ts`** and the template copy: the server-side list.
- **`apps/mercato/src/app/layout.tsx`**, **`AppProviders.tsx`**, **`GlobalNoticeBars.tsx`**, **`AuthFooter.tsx`** and the template copies: resolve the list, mount the provider, the two bar states, the link.
- **`packages/ui`**: the link in the backend and portal shells' footers.
- **`auth/api/locale/route.ts`**: the language cookie's attributes.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Any component → consent | `useConsent` / `ConsentGate` | Outside a provider the hook returns `denied` |
| Operator adding analytics | Adds a category and wraps the script | Documented recipe |

### Frontend architecture contract

| File | Why it is a client file | Imported by | Heavy deps |
|---|---|---|---|
| `ConsentProvider`, `useConsent`, `ConsentGate`, `ConsentSettingsLink` | Read and write a browser cookie | `AppProviders`, the shells, any gated component | None |
| `GlobalNoticeBars` | Already a client file | `AppProviders` | None |

| Budget | Value |
|---|---|
| New page-root client files | 0 |
| Client files over 300 lines | 0 |
| Heavy browser libraries | 0 |
| Evidence | `yarn check:client-boundaries`; the existing providers-imports test |

The provider is mounted where `GlobalNoticeBars` already is, so no server root becomes a client root. The gate reads the cookie in an effect, as the bar does, so the server and the first client render agree. Strings are locale keys in the app's locale files, kept identical with the template.

## 📝 Data Models

None. Two cookies:

| Cookie | Value | Lifetime |
|---|---|---|
| `om_cookie_notice_ack` | `ack` or `dismissed`; only its presence matters | 365 days, as today |
| `om_consent` | `{ <category>: { granted: true \| false, revision: <n> } }` | 180 days |

## 📝 API Contracts

- **`@open-mercato/ui/frontend/consent`** — the four exports and the category type. New, and stable once released.
- **`src/lib/consent.ts`** — an app-owned file, part of the template.
- No route. No server state.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Cookies disabled in the browser | The choice cannot be stored; the bar returns on each page and gated content stays off |
| A malformed `om_consent` | Treated as no answer |
| A category removed from the list | Its stored answer is ignored; nobody is asked again |
| Server rendering | The gate renders its placeholder on the server and on the first client render |
| The bars hidden by the server setting | The gate still denies whatever has no stored yes |
| Consent older than its lifetime | Asked again |
| A customised `GlobalNoticeBars` in an existing application | Keeps its own file; the upgrade note describes the change |

## 📝 Migration & Backward Compatibility

- The bar's default state changes from two equivalent buttons to one. The cookie it writes keeps its name.
- New exports and one new app file are additive. The template is updated in the same change (`yarn template:sync:fix`).
- The language cookie gains attributes; no reader depends on their absence.
- Nothing about telemetry changes.

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | The one-button notice; the language cookie's attributes | Yes |
| 2 | The gate, the second bar state, the settings link | Yes, after Phase 1 |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** the current bar: two buttons, one behaviour. Commit alone.
2. One button; update the characterization test and the locale keys; mirror into the template.
3. The language cookie's attributes. Unit test.
4. Integration test TC-CONSENT-001; `UPGRADE_NOTES.md`.

### Phase 2
1. The consent primitives in `packages/ui`, with unit tests: no cookie; accept; reject; per-category; malformed cookie; a new category; a raised revision; a removed category; outside a provider; render before mount.
2. `src/lib/consent.ts`; the root layout resolves the list and passes it down; the provider is mounted. Mirror into the template.
3. The bar's second state and the "Choose" panel; the reload on save. Component tests.
4. `ConsentSettingsLink` in the sign-in footer and the backend and portal shells. Component tests for both list states.
5. The docs recipe for adding a gated script.
6. Archive this Delta into `.ai/specs/capabilities/cookie-notice-and-consent.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/ui/src/frontend/consent/*` and tests; the backend and portal shell footers | Create / modify |
| `apps/mercato/src/{app/layout.tsx,components/GlobalNoticeBars.tsx,components/AppProviders.tsx,components/AuthFooter.tsx,lib/consent.ts,i18n/*.json}` | Modify / create |
| The same files under `packages/create-app/template/src/` | Modify / create |
| `packages/core/src/modules/auth/api/locale/route.ts` | Modify |
| `apps/mercato/src/components/__tests__/GlobalNoticeBars.characterization.test.tsx` | Create |
| `packages/core/src/modules/auth/__integration__/TC-CONSENT-001.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-CONSENT-001 | In a browser context with no pre-set acknowledgement, using the per-request cookie that turns the bars on for a test: the bar shows one button; pressing it sets the acknowledgement cookie; a reload shows no bar |

The second state of the bar and the gate are covered by component tests: the test application declares no non-essential category, and declaring one would change every other test's page.

## 📝 Risks & Impact Review

#### Something non-essential loads without the gate
- **Scenario**: An operator adds an analytics script directly to the layout.
- **Severity**: High
- **Affected area**: visitors of that installation
- **Mitigation**: The recipe in the docs; the content security policy refuses script origins that were not added on purpose, and the place where they are added points to the recipe.
- **Residual risk**: Nothing forces the wrapper. This spec supplies the means, not the enforcement.

#### The gate ships with nothing using it
- **Scenario**: No first-party code is behind the gate, so it is exercised only by tests.
- **Severity**: Medium
- **Affected area**: confidence that it works in a real page
- **Mitigation**: Component tests for each state; Phase 2 is separable and can wait for a first real use.
- **Residual risk**: A defect found by the first operator who uses it.

#### The template and the app drift
- **Scenario**: The bar changes in one and not the other.
- **Severity**: Medium
- **Affected area**: new applications
- **Mitigation**: Every changed app file is under a directory the sync check compares.
- **Residual risk**: Low.

#### Tests that pre-set the cookie change meaning
- **Scenario**: A test relied on the bar's second button.
- **Severity**: Low
- **Affected area**: the test suites
- **Mitigation**: The cookie name and its presence check are unchanged; the characterization test pins it.
- **Residual risk**: A test that clicks "Accept cookies" by its label; found by the suite.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/create-app/AGENTS.md` → Template Sync Checklist, the frontend architecture contract. Not reviewed in full: `packages/ui/AGENTS.md`.

| Rule | Status | Notes |
|---|---|---|
| Never add code under `apps/mercato/src/` except boilerplate | Needs approval | One new boilerplate file under `src/lib`, mirrored in the template |
| Template sync in the same task | Compliant | Every app file touched is in the sync scope |
| No hard-coded strings | Compliant | Locale keys, identical in app and template |
| Design-system tokens | Compliant | Both buttons use the same shared button variant |
| Frontend architecture contract | Compliant | Included |
| Integration coverage | Partly | One test for the default state; the rest component-tested for the reason given |

**Verdict:** approved for Phase 1, subject to assumption 1. Phase 2 is approved as a design and can wait for a first use.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The built-in telemetry is no longer gated: it is staff-only, the gate could not have stopped it once started, and an existing test opts into it by cookie. The category list is resolved on the server and passed down, because a client file cannot read the settings it would depend on, and it lives under `src/lib`, which the template sync covers. Each category carries a revision instead of the whole list being hashed. The settings link has a named place on each surface, and saving reloads the page. The integration test uses the per-request cookie that shows the bars. Browser-written cookie attributes are left out, and the two phases ship separately.
