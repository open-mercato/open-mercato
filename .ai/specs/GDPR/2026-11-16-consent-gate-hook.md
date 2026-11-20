# Honest cookie notice and a consent gate

> **Program:** package E5 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Code baseline:** `main` at `08dada9624`. G5 covers built-in server-side CAPTCHA verification. An operator-supplied browser widget requires its own category and transfer assessment.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Every page shows a bar that says "We use essential cookies" with two buttons, "Accept cookies" and "Dismiss". Both do the same thing: they hide the bar. Nothing reads which one was pressed, and the product sets only cookies it needs to work, for which no consent is required. So the bar asks for a consent it does not need and would not honour. And an operator who adds analytics has nothing to ask consent with. **Proposed (future):** in two steps that ship separately. First, the bar becomes a plain notice with one button. Second, the application can declare a non-essential category; the same bar then offers Accept and Reject with equal weight, remembers the answer, and a small gate component keeps anything in that category from rendering until the answer is yes. The product itself declares no non-essential category.

**Not in this spec:** gating the built-in browser telemetry, which stays ungated (assumption 2); tenant-owned privacy pages (package E1, [`2026-08-18-tenant-legal-documents-and-consent-versioning.md`](../2026-08-18-tenant-legal-documents-and-consent-versioning.md)); map tiles (package F3, still an issue carrier in the program); proof of consent on a server; consent for marketing email (package E2, [`2026-10-22-crm-contact-permissions-and-consent-history.md`](../2026-10-22-crm-contact-permissions-and-consent-history.md)); the attributes of the thirteen places that write cookies from the browser. A browser category's `revision` and the cookie codec's `version` are not a legal-document version or hash, and "Cookie settings" writes neither legal-acceptance evidence nor CRM contact permissions.

## 📝 Overview

> **Market reference.** The French and Italian regulators' guidance, and consent tools such as Klaro and Cookiebot, agree on four points: no banner is required for strictly necessary cookies; refusing must be as easy as accepting; nothing non-essential may load before a yes; and the choice must be easy to change later. Adopted: all four. Rejected: a full consent-management platform with vendor lists; this is a gate and a banner, not a product.

## 📝 Resolved assumptions

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | With only essential cookies | A notice with one "OK" button, shown once | Showing nothing is also lawful, but ordinary public pages have no footer, so the notice is where a first visit finds the link to `/privacy`. It keeps the existing acknowledgement cookie that the test helpers pre-set, and it is the component Phase 2 extends. An operator who wants no notice edits the app-owned `GlobalNoticeBars`. |
| 2 | Built-in browser telemetry | Not gated; its behaviour does not change, but the G5 cookie and terminal-access inventory lists it | It is off by default, same-origin, and mounted only for signed-in staff. Consent from employees is a weak basis, and some regulators exempt some first-party measurement; whether that exemption applies to a given deployment is the controller's assessment, not this spec's (Known limits). Once started it cannot be stopped, so a gate could not honour a withdrawal, and gating it would silently cut the data of operators who use it. |
| 3 | Where non-essential categories are declared | A category constant resolved inside the existing `apps/mercato/src/app/layout.tsx`, mirrored in the template, and handed to the client as a prop | No new file under the app boilerplate and no root-rule exception. An application can instead own its declaration in a custom module. |
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
- **No footer is shared by every surface.** The sign-in footer is mounted for every frontend page (`AppProviders.tsx:37`) but renders only on the login and onboarding pages (`AuthFooter.tsx:10-13`). The backend's footer is inside `AppShell`, and a page can hide it (`packages/ui/src/backend/AppShell.tsx:1639`). Ordinary public pages such as `/`, `/privacy`, `/terms` and the forms pages have no footer link at all. Only `GlobalNoticeBars` is mounted for every page.
- **Tests depend on the cookie name.** The shared integration helper pre-sets `om_cookie_notice_ack` and `om_demo_notice_ack` (`packages/core/src/helpers/integration/auth.ts:70-76`), as do many specs.
- **No test can see the bars.** The root layout hides them whenever `OM_INTEGRATION_TEST` is `true` (`app/layout.tsx:35`, the same line in the template), and the integration environment always sets it (`packages/cli/src/lib/testing/integration.ts:2225`). No cookie or variable turns them back on for one test. The browser-telemetry opt-in is the model for one: it is inert unless `OM_TEST_MODE=1` and a second variable `OM_TEST_BROWSER_TELEMETRY_MODE=opt-in` are set, and then it is honoured only for a request that carries its cookie (`packages/telemetry/src/browser/server.ts:95-105`; `integration.ts:2232-2236`).
- **The language cookie** is set by the server with no `SameSite` or `Secure` (`auth/api/locale/route.ts:66, 86`).

## 📝 Proposed Solution

### Phase 1 — An honest notice

The bar shows one sentence, the link to `/privacy`, and one "OK" button. It writes the same cookie as today. The language cookie gets `SameSite=Lax` and, in production, `Secure`.

**A test opt-in for the bars.** One function decides whether the bars are shown: `resolveNoticeBarsEnabled({ env, cookieHeader })` in `packages/ui/src/frontend/noticeBars.ts`, a server file with no React. It returns true when `OM_INTEGRATION_TEST` is not `true`, as today. Under `OM_INTEGRATION_TEST=true` it returns true only when `OM_TEST_MODE` is `1`, `OM_TEST_NOTICE_BARS_MODE` is `opt-in`, and the cookie header carries `om_test_notice_bars=on`. This is the same shape as the browser-telemetry opt-in. The root layout calls it with the request's cookie header, in the app and in the template (`apps/mercato/src/app/layout.tsx` and `packages/create-app/template/src/app/layout.tsx`). The integration environment sets `OM_TEST_NOTICE_BARS_MODE=opt-in` beside `OM_TEST_BROWSER_TELEMETRY_MODE` in both of its environment blocks (`integration.ts:2236` and `:3643`). Production sets none of these variables, so there the cookie is never read.

### Phase 2 — The gate

**Declaring.** The existing root `app/layout.tsx` resolves an inline category constant on the server, mirrored in the template. It declares id, title and description locale keys, `essential`, positive integer `revision`, and optional `cleanup`. The shipped list contains only `essential`. No `src/lib/consent.ts` is added. The layout passes the list to `AppProviders` as a prop. Applications with custom modules may import their own declaration there; no new auto-discovery convention is introduced.

**Essential categories.** Always granted, on server and client, regardless of cookie, revision or refusal. `useConsent` returns `granted` for a declared essential category. Essential categories appear as fixed explanatory rows without switches in Choose, never count as unanswered, and are never changed by Accept, Reject or cleanup. Unknown categories and use outside a provider are denied. Outside a provider no declaration exists, so every id, an essential one included, is denied; inside a provider a declared essential category is always granted. A non-essential category is `unset` until its current revision is answered; its gate renders no loader before then.

**Per-context integration category.** Under all of `OM_INTEGRATION_TEST=true`, `OM_TEST_MODE=1`, `OM_TEST_NOTICE_BARS_MODE=opt-in`, `OM_TEST_CONSENT_MODE=opt-in`, and request cookies `om_test_notice_bars=on` and `om_test_consent_category=on`, the server appends a test-only non-essential category and passes `consentTestProbeEnabled` to `AppProviders`. Only that request/context mounts a harmless gated probe marker that creates declared first-party test storage after grant. Both integration environment blocks in `packages/cli/src/lib/testing/integration.ts` set the new mode. No category/probe is added in production or to another context, and the test cookie alone does nothing.

**The bar's second state.** When the list has a non-essential category that the stored answer does not cover at its current revision, the bar shows the same sentence with "Accept" and "Reject" side by side in the same style, and "Choose", which opens the categories with a switch for each non-essential category; essential rows have no switch. The acknowledgement cookie alone does not hide this state. Accept and Reject answer only the declared non-essential categories that are unset at their current revision, including new categories and those with obsolete answers. Apply current choices through the serialized write procedure below. Current-revision answers for other categories keep their values. Choose and Cookie settings let visitors explicitly change an existing answer.

**Serialized browser writes.** All provider writers on the cookie's serving origin use the same exclusive Web Locks API name `om-consent-write`, with no unlocked fallback. Serve a single consent-writing origin per cookie host, including port and scheme. BroadcastChannel and storage events only invalidate readers. In the lock, re-read and validate the authoritative cookie, merge only the visitor's explicitly changed categories, persist one map with a fresh opaque write ID and read it back before reporting success or signalling. Accept/Reject apply only to categories currently unset at the configured revision. Choose captures the cookie write ID when the panel opens and tracks dirty switches only. If a different write committed meanwhile, apply explicit refusals but hold all attempted grants, refresh the panel to current stored choices and ask the visitor to review those grants again. Compare IDs even if the answers became identical in between. On successful write update the displayed snapshot. A committed withdrawal triggers the existing cleanup/reload flow. Abort a timed-out lock request before it can write.

If the API is missing, denied, times out or coordination cannot be established, show a translated unavailable state and keep all non-essential gates denied in that document, including for previously granted categories. Do not persist an unlocked write or display a withdrawal as saved. If a loader already started, unmount it, run its declared cleanup and reload at most once for that failure. The unsupported document remains denied on reload. Its unavailable settings do not overwrite the stored choices of other documents. Do not start loaders until the provider has verified it can obtain the lock and read the cookie.

**The primitives**, exported from `packages/ui`:

- `ConsentProvider`, given the list; it reads the cookie after mount and writes only through serialized browser admission.
- `useConsent(category)`, which returns `granted`, `denied` or `unset`.
- `ConsentGate`, which renders essential children immediately; non-essential children and their loader render only after a current-revision grant. Before mount and for `unset`, a non-essential gate renders its placeholder or nothing. Its non-essential branch mounts a side-effect-free Client Component wrapper or client loader. Server Components passed as children or props can execute ahead of the gate, so do not use them to perform a third-party fetch, preload, resource hint, embed or storage access on its behalf.
- `ConsentSettingsLink`, which renders a "Cookie settings" link only when a non-essential category exists. It opens the "Choose" panel through the provider.

**Changing one's mind.** Once a non-essential category is declared and the visitor has answered, the bar collapses to a small "Cookie settings" button in the same fixed place at the bottom of the screen. `GlobalNoticeBars` renders it, and it is mounted for every page, so the button is on every page, public pages included. It does not depend on a footer or on the page's path. The button opens the same "Choose" panel. In Phase 2 AppProviders mounts GlobalNoticeBars whenever non-essential categories exist, even if `noticeBarsEnabled` hides notices; a separate prop suppresses notice content only. The floating settings entry remains available in that state, and the provider stays mounted. `ConsentSettingsLink` is also placed in the sign-in footer, the backend shell's footer and the portal shell's footer. While a link is mounted, it registers with the provider, and the floating button is not rendered, so a page never shows both. Saving a change first persists a valid refusal, unmounts the newly denied branch, removes the category's declared first-party browser storage, and reloads the page. Cleanup also runs on Reject and when a raised revision invalidates an earlier grant; essential storage is never removed. A started SDK cannot be relied on to stop, so reload follows cleanup. Storage failures are shown as a translated cleanup warning and reload still prevents the script from loading; do not claim that unreadable storage was deleted. A successful write also signals the consent change to other same-origin tabs using `BroadcastChannel` and a value-free storage-event fallback. The cookie is authoritative and the signal contains no answers. In each mounted document, re-read and compare the cookie on a signal, on focus, visibility and `pageshow`, and on a bounded periodic check while visible to recover missed signals. Newly denied or stale grants unmount immediately on detection. Clean that document’s declared session storage and other declared readable storage and reload if the integration already started. Fail closed for an unknown or unreadable answer. A newly mounted loader consults the current cookie before starting.

A category's optional `cleanup` declares cookies by exact `name` with explicit `path` and optional same-site `domain`, or by non-empty `prefix` only with `path: '/'` and a cookie scope guaranteed script-readable on every page where settings can appear. Other-path cookies require exact names; a prefix cannot discover cookies hidden from the current document path. Validate this constraint before accepting category props. Expire exact-name cookies directly using their declared path/domain even when absent from `document.cookie`; enumerate visible cookies only for root-path prefixes. Match only these declarations. Exact `localStorageKeys` and `sessionStorageKeys` are supported. No broad domain/storage clear and no removal of essential/authentication keys. Server-set HttpOnly cookies and third-party-domain cookies cannot be deleted by this client; the recipe requires the vendor's revocation/removal process for them. A prefix may affect only vendor-owned keys. Cleanup does not erase prior vendor processing or provide server-side proof of consent.

**Using it.** An operator adds a category in the root layout or an app-owned module and wraps the integration in the gate. E5 Phase 2 adds the recipe **Adding a non-essential integration** to `apps/docs/docs/deployment/gdpr/index.mdx`, the G5 index owned by [`2026-11-16-gdpr-deployment-docs.md`](2026-11-16-gdpr-deployment-docs.md), **Topics each page must also cover**. That carrier already assigns the cookie inventory to `index`; the recipe is an added section, not existing content. It requires script creation inside the granted branch using `next/script` or `dynamic import()` invoked only after grant. A statically imported wrapper must have no module-level SDK import, network or storage side effects; wrapping rendered JSX does not prevent import-time execution. The recipe declares vendor cleanup keys and explains the third-party/HttpOnly limits. It links [`2026-10-29-production-content-security-policy.md`](../2026-10-29-production-content-security-policy.md) for `OM_CSP_SCRIPT_ORIGINS`, `OM_CSP_CONNECT_ORIGINS`, `OM_CSP_STYLE_ORIGINS` and `OM_CSP_FRAME_ORIGINS`, and `useContentSecurityPolicyNonce` from `@open-mercato/ui/theme/ContentSecurityPolicyProvider`. Keep the existing provider nesting and document nonce stable through client navigation; allowing an origin does not grant consent. A component test proves the dynamic loader is never called before consent or after Reject. The recipe forbids non-essential SDK or vendor calls from Server Components, loaders, route rendering and server-side prefetch on behalf of a gated integration. A vetted wrapper starts all external effects in the granted client branch. A server-side integration needs its own consent mechanism and is outside E5.

### Design decisions

| Decision | Rationale |
|---|---|
| The acknowledgement cookie keeps its name and meaning | The integration helper and many tests pre-set it. |
| Choices live in a separate cookie | An acknowledgement of a notice is not an answer to a question. |
| The list is resolved on the server | See assumption 3. |
| Reject is a button of the same size as Accept | Refusing must be as easy as accepting. |
| The gate controls browser-mounted integrations | The initial server render emits the placeholder. Server-side integration work requires its own authorization design and must never depend on this component. |
| A reload on change | The only way to be sure something stopped. |
| A revision per category | See assumption 7. |
| The settings button is rendered by the bar, not by a footer | The bar is the only element mounted for every page. A footer link alone misses every public page, where an operator is most likely to add analytics. |
| The bars' test opt-in requires three environment predicates and one cookie | Requires `OM_INTEGRATION_TEST`, `OM_TEST_MODE`, the notice mode and its cookie; Phase 2 additionally requires a consent mode and category cookie. Other contexts stay unchanged. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Remove the bar | See assumption 1. |
| Keep both buttons and make them differ | With only essential cookies there is nothing for them to differ about. |
| Gate the built-in telemetry | See assumption 2. |
| A module convention file for categories | A new frozen contract for something no first-party module needs. |
| Store choices in `user_consents` | See assumption 5. |
| Vary the content security policy per visitor | The production CSP design owns nonces and allowed origins; the consent gate decides whether an already-permitted integration loads. The root layout already reads headers for the nonce, so caching is not the reason to reject a second, cookie-dependent CSP policy. |

### Known limits

- A cookie records a choice; it does not prove one. An operator who must demonstrate consent needs a server-side record, which this spec does not provide.
- Nothing forces an operator to use the gate.
- The link on the bar goes to `/privacy`, which names the vendor until package E1 lands; G5's `apps/docs/docs/deployment/gdpr/index.mdx` owns the cookie inventory. E5 updates it in each shipping phase and adds the Phase 2 recipe.
- Built-in browser telemetry is ungated. This spec makes no ePrivacy Art. 5(3) determination for a deployment that enables it: a controller that turns it on decides whether its staff-browser measurement needs consent. E5 Phase 1 adds a browser-telemetry entry to G5's cookie and terminal-access inventory: purpose (staff-interface performance and error measurement), what is sent (traces and metrics to the configured `TELEMETRY_BACKEND`), that it runs only for signed-in staff on the backend, that it sets no cookie of its own, and how to disable it (leave the browser-telemetry server settings unset).
- Outside a `ConsentProvider` no declaration exists, so every category id, an essential one included, is denied; essential-ness is a property only a provider's declared list can establish.

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
The system SHALL NOT render or invoke the loader of a non-essential gated integration until the visitor has accepted its current category revision. Essential categories SHALL always be granted and SHALL not offer a refusal switch.

##### Scenario: Before an answer
- WHEN no choice has been made
- THEN gated content is not rendered

##### Scenario: Essential category
- WHEN only essential categories exist, or the visitor rejects non-essential categories in a mixed list
- THEN essential gates render, `useConsent` reports granted for them, and they never trigger the choice bar or a switch

##### Scenario: Script loading
- WHEN an integration uses the documented granted-branch loader
- THEN its loader is not called before an answer or after Reject; no statically imported SDK runs before grant

##### Scenario: Reject
- WHEN the visitor rejects
- THEN gated content is not rendered on this or later pages, the bar does not return, and the "Cookie settings" button stays

##### Scenario: Settings on every page
- WHEN a non-essential category is declared and the visitor has answered
- THEN every page, public pages included, shows a way to open "Cookie settings": the floating button, or a footer link where one is mounted

##### Scenario: Change of mind
- WHEN the visitor accepted on one page, then opens "Cookie settings" on another page, switches the category off and saves
- THEN the refusal is stored, declared first-party cookies and storage are removed before reload, and gated content in it is not loaded; third-party/HttpOnly cleanup limits are stated A second open tab discards its previous grant and reloads if its SDK was running, without requiring the visitor to navigate there first.

##### Scenario: A new category
- WHEN the declared list gains a category
- THEN a visitor who answered the old list is asked about it. Accept and Reject set only the new category, and all existing current-revision grants and refusals survive the action and reload.

##### Scenario: A changed purpose
- WHEN a category's revision is raised
- THEN that category becomes unset and the visitor is asked again. Accept and Reject affect only unanswered current revisions. Other current-revision grants and refusals survive, and a previously denied category still invokes no loader.

## 📝 Architecture

- **`packages/ui/src/frontend/consent/`**: provider, hook, gate, settings link, the cookie codec. Client files; no dependency.
- **`packages/ui/src/frontend/noticeBars.ts`**: `resolveNoticeBarsEnabled`, the bars' switch and its test opt-in. A server file with no React.
- **`apps/mercato/src/app/layout.tsx`**, **`AppProviders.tsx`**, **`GlobalNoticeBars.tsx`**, and the template copies under `packages/create-app/template/src/`: resolve the inline server-side list and test-only category, the bars' switch, mount the provider, the two bar states and the floating settings button, the link.
- **`packages/cli/src/lib/testing/integration.ts`**: `OM_TEST_NOTICE_BARS_MODE=opt-in` and `OM_TEST_CONSENT_MODE=opt-in` in both environment blocks.
- **`packages/ui/src/frontend/AuthFooter.tsx`**, backend `AppShell` and portal `PortalShell`: the settings link, with translations in the existing app/template locale dictionaries used by shared UI. `packages/ui` has no locale directory today; there is no app/template AuthFooter copy to create.
- **`auth/api/locale/route.ts`**: the language cookie's attributes.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Any component → consent | `useConsent` / `ConsentGate` | Outside a provider the hook returns `denied` |
| Operator adding analytics | Adds a category and wraps the script | Documented recipe |
| Any page → "Cookie settings" | The floating button rendered by `GlobalNoticeBars`, or a mounted `ConsentSettingsLink` | Only essential declared: neither renders |
| Integration test → bars | `om_test_notice_bars=on` with `OM_TEST_MODE=1` and `OM_TEST_NOTICE_BARS_MODE=opt-in` | Bars hidden under `OM_INTEGRATION_TEST=true`, as today |

### Frontend architecture contract

| File | Why it is a client file | Imported by | Heavy deps |
|---|---|---|---|
| `ConsentProvider`, `useConsent`, `ConsentGate`, `ConsentSettingsLink` | Read and write a browser cookie | `AppProviders`, the shells, any gated component | None |
| `GlobalNoticeBars`, with the floating settings button | Already a client file | `AppProviders` | None |
| `noticeBars.ts` | Not a client file: the layout calls it on the server | The root layout | None |

| Budget | Value |
|---|---|
| New page-root client files | 0 |
| Client files over 300 lines | 0 |
| Heavy browser libraries | 0 |
| Evidence | `yarn check:client-boundaries`; the existing providers-imports test |

The provider is mounted where `GlobalNoticeBars` already is, so no server root becomes a client root. Non-essential gates read the cookie in an effect, so server and first client render agree; essential gates render immediately on both. App strings use locale keys kept identical with the template; shared footer and consent primitives use the same existing app/template locale dictionaries, as the footer already does for `common.privacy`. Choose uses shared buttons/switches and dialog keyboard conventions: Escape cancels, Cmd/Ctrl+Enter saves. No new page-root client boundary or SDK dependency.

## 📝 Data Models

No database entity. Four cookie names:

| Cookie | Value | Lifetime |
|---|---|---|
| `om_cookie_notice_ack` | `ack` or `dismissed`; only its presence matters | 365 days, as today |
| `om_consent` | URI-encoded JSON `{ version: 1, writeId?: string, categories: { <id>: { granted: boolean, revision: number } } }` | 180 days (`Max-Age=15552000`) |
| `om_test_notice_bars` | `on`; read only under its opt-in predicates | The test's browser context |
| `om_test_consent_category` | `on`; additionally enables the test category/probe only under its opt-in predicates | The test's browser context |

`om_consent` uses `Path=/; SameSite=Lax`, `Secure` on HTTPS, no Domain (host-only), and is intentionally not HttpOnly so the provider can read it. Encode with `encodeURIComponent(JSON.stringify(...))`; decode once and validate version, ids, booleans and positive revisions with Zod. The writer emits a 22-character base64url write ID derived from 128 bits of cryptographic randomness. Existing version-1 cookies without the ID can be read as one initial snapshot, and the first coordinated save adds it. Maximum encoded value is 3,500 UTF-8 bytes. The structural ceilings are 32 categories and 64 characters per id, subject to a required aggregate declaration check: before enabling the configuration, encode the complete declared category map using a full-length write ID, each actual id/revision and `granted: false` (the longer boolean) with the exact production codec and reject configuration exceeding 3,500 bytes. Revisions are positive safe integers. This check runs again for category/revision changes, so every accepted configuration can persist all possible answer combinations; a visitor is never asked to solve an oversized deployment configuration. The structural ceilings are not a promise that every maximum-size combination is accepted. Reject malformed escapes, unknown versions, oversized values or invalid types as no answer. Save only declared categories. If a new value exceeds the bound or cannot be persisted, show a translated error and keep non-essential gates denied rather than claim success. Unit-test attributes, encoding, limits and malformed values. Pin the rejected 32-by-64-character declaration, the largest accepted encoded declaration and maximum-length legal revisions; every accepted declaration round-trips all-false, all-true and mixed answers within 3,500 bytes. Reject an overflowing revision/configuration update before serving it.

## 📝 API Contracts

- **`@open-mercato/ui/frontend/consent`** — the four exports and the category type, from the directory's `index.ts`. New, and stable once released. The package's `./*/*` wildcard resolves only a single file, so Phase 2 adds an explicit `./frontend/consent` entry to `packages/ui/package.json` (`types`: `./src/frontend/consent/index.ts`, `default`: `./dist/frontend/consent/index.js`), as `./backend/detail` has. `@open-mercato/ui/frontend/noticeBars` is a single file and needs no entry.
- **`@open-mercato/ui/frontend/noticeBars`** — `resolveNoticeBarsEnabled({ env, cookieHeader }): boolean`. New.
- **Category type** — `{ id, titleKey, descriptionKey, essential, revision, cleanup? }`; `cleanup` contains exact/prefix cookie descriptors and exact first-party storage keys as above. Validated before passing props; no new app file.
- **`OM_TEST_NOTICE_BARS_MODE`**, **`OM_TEST_CONSENT_MODE`** — test-only variables set by both integration environment blocks; absent from production `.env.example`. Cookies are never a production feature switch.
- No route. No server state.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Cookies disabled in the browser | The choice cannot be stored; the bar returns on each page and gated content stays off |
| A malformed, unsupported-version or oversized `om_consent` | Treated as no answer; essential remains granted |
| A category removed from the list | Its stored answer is ignored; nobody is asked again |
| Server rendering | Non-essential gates render placeholders on server and first client render; essential gates render immediately |
| Notice content hidden by the server setting | Non-essential grants are still revocable: provider and floating settings entry remain mounted, unless replaced by a footer link; no stored yes means denied |
| A page with a backend, portal or sign-in footer link | The footer link is shown and the floating button is not |
| A backend page that hides its footer | The floating button is shown |
| `om_test_notice_bars=on` without `OM_TEST_MODE=1` and the mode variable | Ignored; the bars stay as the environment decides |
| Consent older than its lifetime | Asked again |
| A customised `GlobalNoticeBars` in an existing application | Keeps its own file; the upgrade note describes the change |

## 📝 Migration & Backward Compatibility

- The bar's default state changes from two equivalent buttons to one. The cookie it writes keeps its name.
- New UI exports and props are additive; category resolution stays inside the existing layout. The template is updated in the same change (`yarn template:sync:fix`).
- The language cookie gains attributes; no reader depends on their absence.
- Phase 1 adds the notice mode; Phase 2 adds the consent mode and a second per-context cookie. A test that does not set the opt-in cookie sees no bars, as today.
- Telemetry behaviour does not change (assumption 2); only its G5 inventory entry is added. E5 is OSS under program DEC-2.

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | The one-button notice; the language cookie's attributes; the bars' test opt-in | Yes |
| 2 | The gate, the second bar state, the floating settings button, the settings link | Yes, after Phase 1 |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** the current bar: two buttons, one behaviour. Commit alone.
2. One button; update the characterization test and the locale keys; mirror into the template.
3. The language cookie's attributes. Unit tests and TC-CONSENT-001 assertions on both POST and GET `Set-Cookie` responses: Path=/, SameSite=Lax, production Secure, and the existing lifetime; use a request-supported locale.
4. `resolveNoticeBarsEnabled` and its use in the root layout of the app and of the template; `OM_TEST_NOTICE_BARS_MODE=opt-in` in both environment blocks of `integration.ts`. Unit tests for the function: outside an integration run the bars are on; under `OM_INTEGRATION_TEST=true` they are off without the cookie, off with the cookie but without `OM_TEST_MODE=1`, off with the cookie but without the mode variable, off for a cookie value other than `on`, and on with all three. Layout tests in `apps/mercato/src/app/__tests__/layout.test.tsx` and `packages/create-app/template/src/app/__tests__/layout.test.tsx`: the request's cookie header reaches the function, and `noticeBarsEnabled` is true under the opt-in.
5. Integration test TC-CONSENT-001; `UPGRADE_NOTES.md`; update the cookie inventory on G5's `apps/docs/docs/deployment/gdpr/index.mdx` for the one-button notice and language-cookie attributes, and add its browser-telemetry entry and the Art. 5(3) limit under Known limits.

### Phase 2
1. The consent primitives in `packages/ui` with their `index.ts` and the explicit `./frontend/consent` entry in `packages/ui/package.json`, with named suites `ConsentProvider.test.tsx`, `ConsentGate.test.tsx`, `consent-cookie.test.ts` and `consent-cleanup.test.ts`: no cookie; accept; reject; per-category; malformed cookie; a new category and a raised revision with mixed stored grants and refusals, testing both Accept and Reject, persistence through reload and loader suppression for unchanged denials; a removed category; outside a provider (an essential id denied too); the `@open-mercato/ui/frontend/consent` import resolving from source and `dist`; render before mount; essential-only/mixed lists always granted with no essential switches; cookie codec version/attributes/size; declared cleanup and inaccessible-storage errors; dynamic loader never called before grant or after Reject.
2. Resolve the inline list and guarded test-only category inside the existing root layout; pass it and the gated test probe flag through AppProviders. Mirror layout, providers and tests into the template. Unit/layout tests reject every missing opt-in predicate and ignore test cookies in production.
3. The bar's second state, Choose and floating Cookie settings; notice visibility no longer unmounts withdrawal access when non-essential categories exist. Cleanup before reload on save. Component tests including server-hidden notices and active grant. Exercise cross-document consent signalling, serialized read–merge–write, stale panel review, abort without unlocked writes and local cleanup without broadcasting answers.
4. `ConsentSettingsLink.test.tsx` and `AppProviders.consent.test.tsx` cover the link in the sign-in footer and the backend and portal shells, with its registration in the provider. Component tests for both list states. Component tests on `AppProviders` with a declared non-essential category and a mocked `usePathname`: accept on `/`, then render `/privacy`, where the floating button is shown, open it, switch the category off and save, and the stored answer is a refusal and the reload is requested; the floating button is shown on `/terms` and on a forms page; it remains shown when notice content is hidden and a non-essential category exists; it is not shown where a `ConsentSettingsLink` is mounted; with only `essential` declared, neither renders on any path.
5. Deliver mandatory TC-CONSENT-002 in Phase 2; both integration environment blocks enable its mode. Add **Adding a non-essential integration** to G5's `apps/docs/docs/deployment/gdpr/index.mdx` and refresh its cookie inventory. The recipe specifies granted-branch script/dynamic loading, first-party cleanup declarations, vendor-domain/HttpOnly limits and the production CSP owner's existing controls. The test probe is the required first exercise; no production non-essential category or telemetry change is required for this phase. Require a production-rendered fixture and an isolated fake-vendor request counter that includes server requests. The browser check separately records outbound requests and resource hints.
6. Archive this Delta into `.ai/specs/capabilities/cookie-notice-and-consent.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/ui/src/frontend/consent/*` (with `index.ts`) and tests; `packages/ui/package.json` (`./frontend/consent` export); `packages/ui/src/frontend/AuthFooter.tsx`; backend and portal shell footers | Create / modify |
| `packages/ui/src/frontend/noticeBars.ts` and `packages/ui/src/frontend/__tests__/noticeBars.test.ts` | Create |
| `packages/cli/src/lib/testing/integration.ts` | Modify |
| `apps/mercato/src/{app/layout.tsx,app/__tests__/layout.test.tsx,components/GlobalNoticeBars.tsx,components/AppProviders.tsx,i18n/*.json}` | Modify / create |
| The same files under `packages/create-app/template/src/`, including `app/layout.tsx` and `app/__tests__/layout.test.tsx` | Modify / create |
| `packages/core/src/modules/auth/api/locale/route.ts` | Modify |
| `apps/mercato/src/components/__tests__/GlobalNoticeBars.characterization.test.tsx` | Create |
| `packages/core/src/modules/auth/__integration__/TC-CONSENT-00{1,2}.spec.ts` | Create |
| `apps/docs/docs/deployment/gdpr/index.mdx` | Update G5 cookie inventory in each phase, including the browser-telemetry entry in Phase 1; add the named recipe in Phase 2 |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-CONSENT-001 | Required lane configuration fails when `OM_TEST_NOTICE_BARS_MODE=opt-in` is not configured for the lane. Its own browser context carries `om_test_notice_bars=on` and the demo acknowledgement, and not the cookie acknowledgement. The bar shows one button; pressing it sets the acknowledgement cookie; a reload shows no bar. A second context without the opt-in cookie shows no bar. Both contexts are closed at the end; assert locale GET and POST Set-Cookie attributes as above; nothing is stored on the server |
| TC-CONSENT-002 | Own browser context carries both opt-in cookies and no prior consent. Test category/probe is absent without all predicates in a second context. In the opted-in context Accept and Reject have equal shared styling; marker and loader are absent before an answer and after Reject, including reload. Cookie settings appears on public `/privacy` and `/terms`; component coverage also pins the server-hidden-notice configuration; Accept loads the marker, which remains after navigation; settings withdrawal persists refusal, deletes probe cookie/local/session storage, reloads, and removes marker/loader. Also plant an exact-name cookie at `/analytics`, withdraw on `/privacy`, then navigate to `/analytics` and prove it is gone; reject a `/analytics` prefix declaration at configuration validation and verify a root-path prefix is cleaned from both pages. Unit tests cover a raised revision; the browser test uses the fixed per-context category without mutating global server configuration. All contexts and their cookies/storage are removed in finally; no shared test-page change or vendor call  In the same browser context start the test SDK in a separate already-open tab, revoke in the first tab and verify cleanup, reload and no further probe sends in both. Repeat with missed broadcast/storage notifications and assert recovery through the bounded visible check or revalidation on focus/pageshow. In two real tabs, pause a Choose save after its in-lock read, race a withdrawal and a disjoint dirty edit, then verify the surviving cookie never restores the withdrawn grant. Open a Choose panel, save a newer refusal in another tab and submit an explicit stale grant from the old panel, including an intervening change that returns to the same cookie choices. Require review before a new grant. Remove or fail the lock API and assert no optional loader, no unlocked write and an accessible unavailable state. Initial HTML and RSC navigation/prefetch contain no non-essential script, embed or resource hints. The fake-vendor server-side counter and browser requests stay at zero on initial render, without hydration, and after Reject. After a current-revision grant the client loader makes the expected request. |

The test-only category is per request and browser context. TC-CONSENT-002 is mandatory with Phase 2; component tests supplement its browser assertions. The ordinary application still declares only essential categories.

## 📝 Risks & Impact Review

#### Something non-essential loads without the gate
- **Scenario**: An operator adds an analytics script directly to the layout.
- **Severity**: High
- **Affected area**: visitors of that installation
- **Mitigation**: Granted-branch dynamic/script loading and a loader-spy component test, plus TC-CONSENT-002; the recipe in the docs; the content security policy refuses script origins that were not added on purpose, and the place where they are added points to the recipe.
- **Residual risk**: Nothing forces the wrapper. This spec supplies the means, not the enforcement.

#### The gate ships with nothing using it
- **Scenario**: No first-party code is behind the gate, so it is exercised only by tests.
- **Severity**: Medium
- **Affected area**: confidence that it works in a real page
- **Mitigation**: Mandatory browser integration with a per-context category/probe and component tests for every state; no external vendor needed.
- **Residual risk**: A vendor SDK may have side effects outside the documented loader; an operator must follow the recipe.

#### Concurrent saves restore a withdrawn grant
- **Scenario**. Two open documents edit settings, or an old Choose panel is submitted after a newer withdrawal.
- **Severity**. High
- **Affected area**. Non-essential browser integrations
- **Mitigation**. Serialize each cookie update, merge only explicit choices and require a fresh panel before admitting an overtaken grant. Prove both orders in TC-CONSENT-002.
- **Residual risk**. Unsupported lock environments deny optional integrations in the affected document and report that the change could not be saved.

#### Withdrawal leaves vendor identifiers
- **Scenario**: A previously granted integration wrote cookies/storage before withdrawal.
- **Severity**: Medium
- **Affected area**: that visitor's browser and vendor processing
- **Mitigation**: Delete declared first-party cookie paths and exact local/session keys before reload; test cleanup in TC-CONSENT-002.
- **Residual risk**: Third-party-domain/HttpOnly cookies and prior vendor processing require vendor-specific handling; script denial alone cannot delete them.

#### The template and the app drift
- **Scenario**: The bar changes in one and not the other.
- **Severity**: Medium
- **Affected area**: new applications
- **Mitigation**: Every changed app file is under a directory the sync check compares.
- **Residual risk**: Low.

#### A visitor cannot find where to withdraw
- **Scenario**: A visitor accepts analytics on a public page, and no settings entry is shown on the public pages they visit later.
- **Severity**: High
- **Affected area**: visitors of an installation that declares a non-essential category
- **Mitigation**: The bar collapses to a "Cookie settings" button rendered on every page by `GlobalNoticeBars`, independent of the path and of any footer. Footer links replace it only where they are mounted. TC-CONSENT-002 covers public withdrawal and navigation; component tests add hidden-footer and mounted-link cases.
- **Residual risk**: An operator who replaces `GlobalNoticeBars` with their own component must keep a settings entry. The docs recipe says so.

#### The floating button covers page content
- **Scenario**: The button sits over a fixed element in the same corner of a custom page.
- **Severity**: Low
- **Affected area**: the look of that page
- **Mitigation**: The button is small, uses the bar's position, and is not rendered where a footer link is mounted.
- **Residual risk**: An operator adjusts their page or mounts a `ConsentSettingsLink` in their own footer.

#### The bars' test opt-in is honoured outside a test
- **Scenario**: A deployment sets `OM_INTEGRATION_TEST=true`, `OM_TEST_MODE=1` and the mode variable, and a visitor sends the cookie.
- **Severity**: Low
- **Affected area**: whether a notice is shown
- **Mitigation**: Three variables that production never sets, as for the telemetry opt-in. Without `OM_INTEGRATION_TEST=true` the bars are already on and the cookie is not read.
- **Residual risk**: The visitor sees the notice that every production visitor sees.

#### Tests that pre-set the cookie change meaning
- **Scenario**: A test relied on the bar's second button.
- **Severity**: Low
- **Affected area**: the test suites
- **Mitigation**: The cookie name and its presence check are unchanged; the characterization test pins it.
- **Residual risk**: A test that clicks "Accept cookies" by its label; found by the suite.

## Final Compliance Report — 2026-11-17

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/create-app/AGENTS.md` → Template Sync Checklist, the frontend architecture contract. Not reviewed in full: `packages/ui/AGENTS.md`.

| Rule | Status | Notes |
|---|---|---|
| No new app boilerplate file | Compliant design | Category list is inside the existing layout; shared footer lives in packages/ui |
| Template sync in the same task | Compliant | Every app file touched is in the sync scope, including `app/layout.tsx` and its test, mirrored under `packages/create-app/template/src/app/` |
| Withdrawal as easy as consent (Art. 7(3)) | Compliant | A settings entry on every page: the floating button, or a footer link where one is mounted |
| No hard-coded strings | Compliant | Locale keys, identical in app and template |
| Design-system tokens | Compliant | Both buttons use the same shared button variant |
| Frontend architecture contract | Compliant | Included |
| Integration coverage | Required delivery gate | TC-CONSENT-001 covers notice and locale headers; TC-CONSENT-002 covers the gate, equal choice, public settings and withdrawal/cleanup in its own context |

**Verdict:** Design ready with proposed OSS placement. Written upstream approval must name this proposed OSS carrier under [DEC-2](2026-11-15-gdpr-ready-deployments-program.md#decisions) before implementation or OSS submission. Phase 1 ships independently after that approval. Phase 2 ships with TC-CONSENT-002 and the named G5 docs section, without waiting for a first production use. The shipped application still declares only essential categories. Each PR receives ordinary maintainer review.
## Changelog

- 2026-11-16 — Initial specification.
