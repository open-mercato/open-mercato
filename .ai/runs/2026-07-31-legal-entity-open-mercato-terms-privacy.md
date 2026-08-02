# Legal entity migration: CT Tornado sp. z o.o. → Open Mercato sp. z o.o. (terms, privacy, CLA, licences)

## Goal

The operating legal entity behind the Open Mercato platform moved from **CT Tornado sp. z o.o.** to
**Open Mercato sp. z o.o.** Every public legal document still names the old entity and its old
registration identifiers, which makes the published Terms of Service, Privacy Policy, Contributor
Licence Agreement and the commercial-licence notices legally incorrect. This run replaces the
identity and registration data everywhere it appears in legal copy.

## New entity data (authoritative, English rendering)

| Field | Old (CT Tornado) | New (Open Mercato) |
|-------|------------------|--------------------|
| Legal name | CT Tornado sp. z o.o. | Open Mercato sp. z o.o. |
| Defined short term | "CTT" | "Open Mercato" |
| Registered address | ul. Wyspa Słodowa 7, 50-266 Wrocław, Poland | unchanged |
| Registry court | District Court for Wrocław-Fabryczna in Wrocław | District Court for Wrocław-Fabryczna in Wrocław, VI Commercial Division of the National Court Register, Register of Entrepreneurs |
| KRS / company no. | 873910 | 0001253104 |
| NIP / EU VAT no. | PL8982262377 | PL8982336029 |
| REGON | (not stated) | 545230330 |
| Share capital | PLN 5,000.00 | PLN 80,000.00 |
| Contact email | info@catchthetornado.com | info@openmercato.com |

**Decisions recorded (autonomous run, no user in the loop):**

1. **Share capital is PLN 80,000.00.** The owner confirmed this figure while the PR was awaiting QA.
   The rendered Terms and Privacy pages and the CLA retain the share-capital disclosure that existed
   for the old entity, now with the confirmed amount. The onboarding legal-entity disclosure and its
   four locale variants are corrected from the superseded PLN 5,000.00 figure in the same follow-up.
2. **"CTT" is expanded to "Open Mercato" rather than re-abbreviated to "OM".** The Terms define the
   short term once and then use it ~65 times. "Open Mercato" is already the product name used
   throughout the same document, so a single consistent term removes an abbreviation the reader has
   to hold in their head.
3. **The registry description gains the division and register name** (VI Commercial Division of the
   National Court Register, Register of Entrepreneurs), rendered in English as the user requested,
   because the supplied KRS data names them explicitly.
4. **`info@catchthetornado.com` becomes `info@openmercato.com`** in legal copy. That address is
   already the contact address used in 20+ places elsewhere in the repository, so this is an
   alignment rather than a new choice.

## Scope

In scope — documents that make a legal-entity statement:

- `packages/content/src/modules/content/frontend/terms/page.tsx` (the rendered Terms of Service)
- `packages/content/src/modules/content/frontend/privacy/page.tsx` (the rendered Privacy Policy)
- `apps/docs/cla.md` (Contributor Licence Agreement)
- `packages/enterprise/LICENSE.md` (commercial-licence grantor)
- `.ai/specs/LICENSE.md` (commercial-licence grantor)
- `SECURITY.md` (vulnerability-disclosure contact address)
- `packages/onboarding/src/modules/onboarding/` legal-entity disclosure copy and its locale regression
  coverage, because PR #4751 had carried over the old entity's PLN 5,000.00 capital figure

## Non-goals

- **`README.md`'s "proudly supported by Catch The Tornado" sponsorship credit and logo.** This is an
  attribution to a supporter, not a statement about who operates the platform, and it remains
  factually true after the entity move. Untouched deliberately; raised in the PR body for the user.
- **`ADMIN_EMAIL` fallbacks (`piotr@catchthetornado.com`) in the onboarding module.** These are
  operational environment defaults, not legal-entity statements, and changing them would silently
  redirect demo-feedback and onboarding notification mail. Raised in the PR body.
- **The onboarding marketing-consent controller names.** Already migrated on `main` by PR #4751
  (`fix(onboarding): name Open Mercato sp. z o.o. as the marketing-consent controller`), merged
  2026-07-31. Only the legal-entity disclosure's now-confirmed share-capital amount changes here.
- Re-dating the documents ("Effective as of January 1, 2026"). The effective dates are a legal
  decision for the user, not a mechanical consequence of the entity change.

## Risks

- **Legal copy is user-visible and binding.** A wrong identifier is worse than no change, so every
  number is transcribed from the brief and locked in by a regression test rather than trusted to
  review-by-eye.
- **The Terms page has ~65 `CTT` occurrences.** A careless global replace could hit unrelated
  substrings. Mitigated by asserting on the rendered output that no `CT Tornado` / `CTT` / old
  identifier survives anywhere in the content module.
- Existing content tests assert section headings and links only; they will not catch identity drift.
  Phase 3 closes that gap.

## Progress

PR: #4755

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Rendered legal pages

- [x] 1.1 Replace the entity block and every CTT reference in the Terms of Service page — b04804414
- [x] 1.2 Replace the entity block, controller identity and contact details in the Privacy Policy page — b04804414

### Phase 2: Contributor agreement and licence notices

- [x] 2.1 Update the CLA's entity definition and every CTT reference — 5c3a92150
- [x] 2.2 Update the commercial-licence grantor in `packages/enterprise/LICENSE.md` and `.ai/specs/LICENSE.md` — 5c3a92150
- [x] 2.3 Point the SECURITY.md disclosure contact at the Open Mercato address — 5c3a92150

### Phase 3: Regression coverage

- [x] 3.1 Add a content-module test asserting the new entity data renders and no legacy identifier survives — 87eb28529

### Phase 4: Validation and delivery

- [x] 4.1 Run the full validation gate — green except a pre-existing, unrelated `i18n:check-usage` failure (2 missing keys in `packages/ui/src/backend/fields/phone.tsx`, present on `main`, untouched by this PR)
- [x] 4.2 Run `om-auto-review-pr` and apply any resulting fixes — no code fixes required; review surfaced two human legal decisions (CLA counterparty, share-capital inconsistency) recorded on the PR

### Phase 5: Confirmed share-capital correction

- [x] 5.1 Publish the confirmed PLN 80,000.00 share capital across Terms, Privacy, the CLA, and onboarding disclosure locales — 2f650fb20
- [x] 5.2 Extend content and onboarding regression coverage for the confirmed amount — 2f650fb20

### Phase 6: Revalidation and delivery

- [x] 6.1 Re-run the full configured validation gate — full gate passed; `i18n:check-usage` reports only the pre-existing advisory phone-field keys
- [x] 6.2 Re-run `om-auto-review-pr` and apply any resulting fixes — APPROVED; trailing-space cleanup in 78b22354b
