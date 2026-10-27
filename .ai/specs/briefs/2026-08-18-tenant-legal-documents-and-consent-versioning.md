# Tenant-scoped legal documents as versioned data in content, configurable data-controller identity, and append-only consent evidence in auth

- Date: 2026-08-18
- Category: feature
- Priority signal: high — every app scaffolded with create-mercato-app serves Open Mercato sp. z o.o.'s legal documents and consent labels as its own by default: legally false content naming a data controller that does not process that app's data.
- Risk signal: medium — additive with fallbacks, but it touches the auth consent-integrity hash (three past security issues) and a multi-module surface (content, auth, onboarding, checkout, create-app template).
- Routing: Next: om-auto-write-spec "Tenant-scoped legal documents as versioned data in content, configurable data-controller identity, and append-only consent evidence in auth — brief: .ai/specs/briefs/2026-08-18-tenant-legal-documents-and-consent-versioning.md"

## Problem

The platform's legal documents (`/privacy`, `/terms`) are hardcoded English JSX in `packages/content` carrying the vendor's real data-controller identity, and the marketing-consent labels in `packages/onboarding` (four locale files, `OnboardingPageClient.tsx`, `DemoFeedbackWidget.tsx`) name the same vendor as controller. Both modules are enabled by default in the create-app template (`packages/create-app/template/src/modules.ts:81-82`), so every scaffolded client app impersonates the vendor's legal identity out of the box. Renaming the vendor once (CT Tornado → Open Mercato sp. z o.o.) cost two PRs in two modules (#4755, #4751) because the identity is baked into package code. Separately, `auth` records that a consent was granted but not against which document version — `UserConsent` is mutable with `@Unique(['userId','tenantId','consentType'])`, so re-consent overwrites prior evidence — while `checkout` carries a third, independent copy of the legal-documents concept (per-pay-link `LegalDocumentValue` with immutable acceptance proof). Good OSS practice is unambiguous: the framework ships mechanism, not vendor identity; a fresh install must be neutral or explicitly unconfigured, never impersonate the vendor; the vendor dogfoods the same mechanism, so its own texts become deployment data of its own instance.

## Agreed direction

One OSS spec, owned by the `content` module, with the template-defaults neutralization as its independently shippable phase 1:

1. **Legal document as a data record in `content`**: title, markdown per locale, version, effective date; tenant-scoped configuration with fallback to built-in neutral sample text clearly marked as a placeholder ("Sample Privacy Policy — replace before production"). The existing `/privacy` and `/terms` pages render from these records. This deliberately amends `content`'s AGENTS.md contract (today: stateless components, no business logic) — a conscious decision, not an oversight; the spec must update that contract as part of the change.
2. **Data-controller identity as tenant-scoped configuration** (the `configs` mechanism), NOT a content entity: `content` pages, `onboarding` consent labels, and checkout footers read the controller name from it. The next vendor/company rename becomes a data change, not multi-module PRs.
3. **Append-only consent event log in `auth`**: immutable events (grant/withdraw, document id, document version, content hash) providing audit-grade evidence of which document version was in force when consent was given. Requires a versioning scheme for the consent-integrity hash payload (see constraints).
4. **Checkout defaults from the tenant's legal-document records; the per-link override stays** — per-link documents are a deliberate feature (bespoke terms for a specific offer), not drift to delete.
5. **Phase 1 = neutral defaults**: minimal document record + neutral sample seeds + template neutralization, deployable before the consent-log phases. The challenger preferred an immediate pre-spec PR for neutralization; rejected because with controller identity now in scope such a PR would guess the configuration shape and fight the identity-lock tests — phase 1 of the spec does it against the designed shape instead.

Rejected alternatives: a monolithic `gdpr` module (GDPR capabilities already have owners — content/auth/checkout/enterprise-erasure — and an umbrella would need cross-module reach the architecture forbids); a separate narrow `legal_documents` module (would hollow `content` out into a renderer of another module's data and add coupling where pages + data are one responsibility); build nothing (every scaffolded app keeps serving legally false vendor documents, and vendor identity changes keep costing multi-module PRs — the cost is proven twice and the repo even grew tests to manage it).

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Motivation — client deadline or product correctness? | Product correctness / OSS good practice; no client deadline. The default is simply wrong today. |
| Is data-controller identity in scope, or documents only? | In scope. Identity becomes tenant-scoped configuration consumed by content, onboarding, and checkout; the spec covers the onboarding consent-label surface, closing the second half of the rename cost. |
| Where does controller identity live? | Tenant-scoped `configs`, not a content entity — four modules consume it; putting it in content would make onboarding depend on content for something that is not content. |
| Consent evidence model — pin a version on the mutable row, or append-only log? | Append-only consent event log (grant/withdraw, doc id, version, content hash). Pinning on the mutable `UserConsent` row was rejected: re-consent overwrites prior evidence, defeating the audit purpose. Checkout's per-transaction immutable proof is the in-repo precedent. |
| Module placement — extend `content` or new `legal_documents` module? | Extend `content` (user decision). Legal pages are content's core job; a separate module would split ownership and add render-path coupling. The AGENTS.md contract amendment is part of the spec. |
| Checkout — consume the shared source or keep its copy? | Default new pay links from the tenant's legal-document records; keep the per-link override unchanged. |
| How do auth/checkout reference documents? | FK-id + snapshot pattern only (id, version, content hash stored as own data); no hard dependency on content, no cross-module ORM relations. |
| What does a fresh scaffolded app serve at `/privacy`? | Neutral sample content clearly marked as a placeholder, never vendor documents. "Looks configured but names a foreign controller" is worse than "explicitly unconfigured". |
| Where do Open Mercato's own texts go? | Deployment data of OM's own instance (seed/config of that deployment) — not package code, and not `apps/mercato` (forbidden: it is the user boilerplate). |
| Do it now or park it? | Now — write the spec (ramp 3). |

## Non-goals

- GDPR Art. 17 erasure — separately specced in `.ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md`; this spec's consent log must not collide with it.
- A monolithic `gdpr` umbrella module.
- A generic CMS: content's data records are scoped to legal documents (version, effective date, consent linkage) — nothing beyond.
- Anything from PR #4561's collaborative internal-documents editor; the module name `documents` is claimed by that PR and must not be used here.
- Removing checkout's per-link document customization.

## Affected areas (if known)

- `packages/content` — `frontend/privacy/page.tsx`, terms sibling; new entities/API/admin UI; AGENTS.md contract amendment; `src/__tests__/legal-entity.test.tsx` is a deliberate identity lock on main (asserts 'Open Mercato sp. z o.o.', KRS/NIP, absence of the superseded identity) and must be rewritten into neutral-default tests, not fought.
- `packages/core/src/modules/auth` — `UserConsent` entity (`data/entities.ts:318`, unique per consent type, mutated in place), `lib/consentTypes.ts`, `lib/consentIntegrity.ts:46-58` (`computeConsentIntegrityHash` HMACs a fixed 7-field pipe-joined payload; adding fields invalidates every existing row's `integrityValid`, omitting them leaves the pinned version tamperable — the spec needs a hash-payload versioning scheme; scrutiny history: #2726, #2690, #2743). The consentType→document mapping is not 1:1 (marketing consent has no document; privacy/terms do) and needs explicit definition.
- `packages/onboarding` — consent-label locale files (`i18n/{en,de,pl,es}.json`), `OnboardingPageClient.tsx`, `DemoFeedbackWidget.tsx`; `src/__tests__/consent-controller-locales.test.ts` is the second deliberate identity lock.
- `packages/checkout` — `legalDocumentsSchema` (`data/validators.ts:78-81`), pay-link form default prefill.
- `packages/create-app/template` — module defaults (`src/modules.ts:81-82`), neutral seeds; every `apps/mercato`-mirrored change follows the Template Sync Checklist.
- Tracker adjacency: open #3820 (consent read tenant-scoping, partially fixed by #5236) touches the same read path; open PR #4561 claims the `documents` module name.
