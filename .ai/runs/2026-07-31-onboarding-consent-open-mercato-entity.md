# Onboarding consent checkbox — name Open Mercato sp. z o.o. as the controller

**Run:** `om-auto-create-pr`
**Date:** 2026-07-31
**Branch:** `fix/onboarding-consent-open-mercato-entity`
**Base branch:** `main` (explicit user override of the configured `develop`)

## Goal

The self-service onboarding form at `/onboarding` (live: <https://demo.openmercato.com/onboarding>) asks
the user to consent to direct marketing from **CT Tornado**. That is the wrong legal entity: the
marketing controller for Open Mercato onboarding is **Open Mercato sp. z o.o.**. Consent collected
naming the wrong controller is not valid consent for the entity that actually processes the address,
so the checkbox copy has to name the correct company, together with its registration details.

## Scope

In scope:

1. The onboarding marketing-consent checkbox label (`onboarding.form.marketingLabel`) — replace
   "CT Tornado" with "Open Mercato sp. z o.o." in all four shipped locales (`en`, `pl`, `de`, `es`)
   and in the inline English fallback inside `OnboardingPageClient.tsx`.
2. A new legal-entity disclosure line rendered under the consent checkboxes on the onboarding form,
   carrying the full registered-entity details supplied in the brief (registered office, KRS court and
   number, NIP, REGON, share capital). New i18n key `onboarding.form.legalEntity` in all four locales.
3. The demo-feedback widget's marketing-consent label (`demoFeedback.form.marketingLabel`), which
   lives in the same onboarding i18n files and names the same wrong controller. Its inline fallbacks
   live in `apps/mercato/src/components/DemoFeedbackWidget.tsx` and the mirrored
   `packages/create-app/template/src/components/DemoFeedbackWidget.tsx`; per the create-app Template
   Sync Checklist both are updated in the same change.
4. A unit test locking in that no shipped locale advertises marketing consent to a controller other
   than Open Mercato, and that the legal-entity key is present and consistent across locales.

Non-goals (deliberately untouched, flagged for a human legal decision on the PR):

- `packages/content/src/modules/content/frontend/terms/page.tsx` and `.../privacy/page.tsx` still
  describe **CT Tornado sp. z o.o.** as the platform operator and privacy controller. Rewriting the
  Terms of Service and Privacy Policy is a legal-content decision well beyond "change the checkbox",
  and it changes the meaning of documents users have already accepted. Flagged on the PR instead.
- `apps/docs/cla.md` intentionally keeps CT Tornado — the CLA is the contributor agreement with the
  project steward, a different relationship from the marketing controller.
- No change to consent storage, the consent audit trail, validators, or the onboarding API contract.

## Risks

- **Legal-entity inconsistency across surfaces (accepted, flagged).** After this change the consent
  checkbox names Open Mercato sp. z o.o. while `/terms` and `/privacy` still name CT Tornado. This is
  strictly better than the status quo for the consent itself, but the mismatch is called out on the PR
  so the owner can decide whether the legal pages follow.
- **Locale drift.** Four locales plus a new key; `yarn i18n:check-sync` is the gate that catches a
  missed locale. Translations for `pl`, `de`, `es` keep the existing sentence structure and only swap
  the controller name, so no re-translation risk beyond the company name and the appended legal line.
- **Hardcoded-string checker.** The new legal-entity line is a translatable key with an English
  fallback, matching how every other string on this form is written, so `yarn i18n:check-usage`
  and the hardcoded-string checker stay satisfied.

## Implementation Plan

### Phase 1: Consent copy and legal-entity disclosure

- Replace the controller name in `onboarding.form.marketingLabel` and `demoFeedback.form.marketingLabel`
  across `en`, `pl`, `de`, `es`.
- Add `onboarding.form.legalEntity` with the full registration blurb to all four locales.
- Update `OnboardingPageClient.tsx`: the inline fallback for the marketing label, and a new muted
  legal-entity paragraph rendered below the consent checkboxes.
- Mirror the inline fallback change in both `DemoFeedbackWidget.tsx` copies (app + create-app template).

### Phase 2: Regression test and validation gate

- Add a unit test asserting that no shipped onboarding locale mentions the superseded controller in a
  marketing-consent label, that each locale names Open Mercato sp. z o.o., and that
  `onboarding.form.legalEntity` exists in every locale with the KRS/NIP/REGON identifiers present.
- Run the configured validation gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Consent copy and legal-entity disclosure

- [ ] 1.1 Update marketing-consent controller name in all four onboarding locale files
- [ ] 1.2 Add `onboarding.form.legalEntity` to all four onboarding locale files
- [ ] 1.3 Update `OnboardingPageClient.tsx` fallback copy and render the legal-entity line
- [ ] 1.4 Mirror the demo-feedback fallback copy in app and create-app template widgets

### Phase 2: Regression test and validation gate

- [ ] 2.1 Add the locale consent-controller regression test
- [ ] 2.2 Run the full validation gate and fix any failures
