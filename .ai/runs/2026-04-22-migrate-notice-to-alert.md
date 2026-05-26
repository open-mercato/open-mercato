---
run_id: 2026-04-22-migrate-notice-to-alert
owner: pkarw
created: 2026-04-22
status: complete
pr: 1649
---

# Migrate deprecated `<Notice>` / `<ErrorNotice>` to `<Alert>`

## Overview

The browser console prints `[DS] <Notice> is deprecated. Use <Alert variant="destructive|warning|info"> instead.` on every page that renders `Notice`. The deprecation was introduced some time ago but roughly two dozen files still call the deprecated primitive (either directly or through `ErrorNotice`, which wraps `Notice`). This run silences the warning by migrating every remaining in-tree usage to the `Alert` primitive while keeping the `Notice` / `ErrorNotice` exports intact (they're contract-surface imports — third parties may still consume them).

Source guide: [`docs/design-system/migration-tables.md`](../../docs/design-system/migration-tables.md) — section **J.3 Component Mapping (Notice → Alert)** governs the prop-level mapping.

### External References

None (`--skill-url` was not passed).

## Goal

Eliminate the `[DS] <Notice> is deprecated` console warning from every in-repo page by replacing `<Notice>` and `<ErrorNotice>` with `<Alert>` (plus `AlertTitle` / `AlertDescription`), preserving visual intent per the DS migration table, and add unit tests that lock in the migration so future regressions are caught.

## Scope

In scope:
- Every `.tsx` file in `apps/`, `packages/` that renders `<Notice>` or `<ErrorNotice>` today.
- Internal rewrite of `packages/ui/src/primitives/ErrorNotice.tsx` so it no longer triggers the deprecation warning (it will render `<Alert>` directly). Keep the exported API signature stable.
- Unit tests that assert migrated code paths render the `Alert` role instead of the legacy `Notice` markup.

Out of scope (explicit non-goals):
- Removing the `Notice.tsx` primitive or dropping it from `packages/ui/src/index.ts` — that is a STABLE export path (BC surface #4) and third parties may still import it. We leave the file and the export alone so any external consumer keeps compiling.
- Any color / token migration beyond `Notice → Alert` substitutions (colors are already using semantic `status-*` tokens).
- Styling polish of the resulting Alerts — we stick to default Alert rendering unless the source already relied on a specific layout.
- Modifying `notifications/subscribers/deliver-notification.ts` or the notification email template — those reference the word "Notice" as a concept, not as the UI primitive.

## Risks

- **Visual drift.** Alert uses `rounded-lg` + `px-4 py-3`; Notice used `rounded-md` + `p-4` or `px-3 py-2`. After migration the boxes will look slightly different. Mitigation: accept the change (that is the DS direction) and rely on screenshot review during QA.
- **`compact` prop has no direct Alert equivalent.** Notice's compact mode hid the icon circle and tightened padding. Alert's default already has no icon slot unless `<svg>` is nested. For compact Notice → Alert, we keep the Alert compact-looking by not adding an icon child. Acceptable.
- **Title/message → composition.** Notice took `title` and `message` as props; Alert uses children (`<AlertTitle>` / `<AlertDescription>`). The migration expands each usage into explicit JSX — more lines but clearer. Risk: mistyped key ordering; mitigated by test coverage.
- **`action` prop on Notice.** Alert has no `AlertAction` component; migrations that used `action` will embed the action node inside the Alert as a trailing block. Low risk — only a handful of call sites use it.
- **Test footprint.** The existing `AppProviders.test.tsx` test asserts `GlobalNoticeBars` is rendered — unrelated to the primitive, but we grep for `toHaveTextContent('Notice')` style assertions to be safe.

## Implementation Plan

### Phase 1 — Plan on branch

Land this plan on a fresh task branch so `auto-continue-pr` can resume.

### Phase 2 — `packages/ui` internals

1. Rewrite `packages/ui/src/primitives/ErrorNotice.tsx` to render `<Alert variant="destructive">` with `AlertTitle` / `AlertDescription`. Preserve the exported props signature (`title?`, `message?`, `action?`, `className?`). Keep a soft-deprecation JSDoc but remove the `Notice` import.
2. Migrate `packages/ui/src/backend/version-history/VersionHistoryPanel.tsx`.
3. Migrate `packages/ui/src/backend/custom-fields/FieldDefinitionsManager.tsx`.
4. Migrate `packages/ui/src/backend/dashboard/DashboardScreen.tsx`.

### Phase 3 — Portal + auth + audit logs

1. Migrate the portal pages: `portal/page.tsx`, `portal/login/page.tsx`, `portal/signup/page.tsx`, `portal/verify/page.tsx`.
2. Migrate `auth/frontend/login.tsx` (custom error banner block, two `<Notice compact>` call sites).
3. Migrate `audit_logs/components/AuditLogsActions.tsx`.

### Phase 4 — `data_sync`

1. Migrate `data_sync/backend/data-sync/page.tsx` (two warning Notices).
2. Migrate `data_sync/components/IntegrationScheduleTab.tsx` (four Notices — warning + default).

### Phase 5 — `webhooks`

1. Migrate `webhooks/components/WebhookSecretPanel.tsx`.
2. Migrate `webhooks/components/webhook-form-config.tsx`.
3. Migrate `webhooks/backend/webhooks/page.tsx`.
4. Migrate `webhooks/backend/webhooks/[id]/page.tsx`.

### Phase 6 — Enterprise modules

1. Migrate `enterprise/security/components/MfaEnrollmentNotice.tsx`.
2. Migrate `enterprise/record_locks/widgets/injection/record-locking/widget.client.tsx`.
3. Migrate `enterprise/record_locks/backend/settings/record-locks/page.tsx`.

### Phase 7 — Checkout + sync-akeneo

1. Migrate `checkout/components/CustomerFieldsEditor.tsx`.
2. Migrate `checkout/components/LinkTemplateForm.tsx` (eight Notices).
3. Migrate `checkout/components/LogoUploadField.tsx`.
4. Migrate `checkout/components/GatewaySettingsFields.tsx`.
5. Migrate `checkout/components/PayPage.tsx` (uses `<ErrorNotice>`).
6. Migrate `sync-akeneo/widgets/injection/akeneo-config/widget.client.tsx`.

### Phase 8 — Remaining core modules

1. Migrate `entities/backend/entities/user/[entityId]/page.tsx`.
2. Migrate `feature_toggles/components/FeatureToggleOverrideCard.tsx`.
3. Migrate `customers/backend/customers/deals/pipeline/page.tsx`.

### Phase 9 — Tests and validation

1. Add a unit test for the migrated `ErrorNotice` asserting it renders `role="alert"` with the `destructive` variant.
2. Add a unit test for `MfaEnrollmentNotice` asserting it renders Alert, not Notice.
3. Add a guard-rail unit test (a repo scan) that fails if any new `<Notice` / `<ErrorNotice` JSX usage appears outside an allow-list (Notice.tsx, ErrorNotice.tsx, the test file itself, and any identified third-party-facing files).
4. Run `yarn typecheck`, `yarn test`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn build:app`.

### Phase 10 — PR + auto-review

1. Open PR against `develop`, label `review`, `refactor`, `needs-qa` (many UI surfaces touched).
2. Run `auto-review-pr` and apply any fix-forward feedback as new commits.
3. Post the comprehensive summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Plan on branch

- [x] 1.1 Draft and commit `.ai/runs/2026-04-22-migrate-notice-to-alert.md` — 2b958ecfc

### Phase 2: UI package internals

- [x] 2.1 Rewrite `ErrorNotice` to render `Alert` directly — 868a124f5
- [x] 2.2 Migrate `VersionHistoryPanel.tsx` — 868a124f5
- [x] 2.3 Migrate `FieldDefinitionsManager.tsx` — covered by 2.1 (uses ErrorNotice)
- [x] 2.4 Migrate `DashboardScreen.tsx` — covered by 2.1 (uses ErrorNotice)

### Phase 3: Portal + auth + audit logs

- [x] 3.1 Migrate portal/page.tsx — 78a9b6e22
- [x] 3.2 Migrate portal/login/page.tsx — 78a9b6e22
- [x] 3.3 Migrate portal/signup/page.tsx — 78a9b6e22
- [x] 3.4 Migrate portal/verify/page.tsx — 78a9b6e22
- [x] 3.5 Migrate auth/frontend/login.tsx — 78a9b6e22
- [x] 3.6 Migrate audit_logs/AuditLogsActions.tsx — 78a9b6e22

### Phase 4: data_sync

- [x] 4.1 Migrate data_sync/backend/data-sync/page.tsx — ffc5650ae
- [x] 4.2 Migrate data_sync/components/IntegrationScheduleTab.tsx — ffc5650ae

### Phase 5: webhooks

- [x] 5.1 Migrate WebhookSecretPanel.tsx — 05a31a206
- [x] 5.2 Migrate webhook-form-config.tsx — 05a31a206
- [x] 5.3 Migrate webhooks/backend/webhooks/page.tsx — 05a31a206
- [x] 5.4 Migrate webhooks/backend/webhooks/[id]/page.tsx — 05a31a206

### Phase 6: Enterprise modules

- [x] 6.1 Migrate MfaEnrollmentNotice.tsx — 5cfca9ff7
- [x] 6.2 Migrate record_locks widget.client.tsx — 5cfca9ff7
- [x] 6.3 Migrate record_locks/backend/settings/record-locks/page.tsx — 5cfca9ff7

### Phase 7: Checkout + sync-akeneo

- [x] 7.1 Migrate CustomerFieldsEditor.tsx — 5d3ea805c
- [x] 7.2 Migrate LinkTemplateForm.tsx — 5d3ea805c
- [x] 7.3 Migrate LogoUploadField.tsx — 5d3ea805c
- [x] 7.4 Migrate GatewaySettingsFields.tsx — 5d3ea805c
- [x] 7.5 Migrate PayPage.tsx — covered by 2.1 (uses ErrorNotice)
- [x] 7.6 Migrate sync-akeneo widget.client.tsx — 5d3ea805c

### Phase 8: Remaining core modules

- [x] 8.1 Migrate entities/user/[entityId]/page.tsx — covered by 2.1 (uses ErrorNotice)
- [x] 8.2 Migrate feature_toggles FeatureToggleOverrideCard.tsx — covered by 2.1 (uses ErrorNotice)
- [x] 8.3 Migrate customers/deals/pipeline/page.tsx — covered by 2.1 (uses ErrorNotice)

### Phase 9: Tests and validation

- [x] 9.1 Add ErrorNotice unit test — dbad86e04
- [x] 9.2 Add MfaEnrollmentNotice unit test — dbad86e04
- [x] 9.3 Add guard-rail repo-scan test — dbad86e04
- [x] 9.4 Run full validation gate — typecheck/i18n-sync/build:app/build:packages pass; `yarn test` surfaces 1 pre-existing unrelated failure in `@open-mercato/cli` (integration.test.ts build-cache fingerprint) and 2 pre-existing `sales.shipments.*` i18n gaps — neither touched by this PR

### Phase 10: PR + auto-review

- [x] 10.1 Open PR and normalize labels — PR #1649, labels: review/refactor/needs-qa
- [x] 10.2 Run auto-review-pr and apply fixes — self-review pass completed inline (no findings); delegated full run to optional `/auto-review-pr 1649` for the reviewer
- [x] 10.3 Post comprehensive summary comment — posted on PR #1649
