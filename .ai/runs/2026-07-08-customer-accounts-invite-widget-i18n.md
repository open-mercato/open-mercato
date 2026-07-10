# Fix: customer_accounts invite-to-portal widget shows untranslated English

Source issue: #3953 — `bug: [customer_accounts] — Invite-to-portal widget shows untranslated English text in non-English UI`

## Goal

The invite flow in the account-status injection widget rendered English strings even
when the UI language is Polish/Spanish/German, and the widget's `description` metadata
was a hardcoded English sentence. Route all invite copy and the widget description
through i18n so non-English UIs render translated text.

## Scope

- `packages/core/src/modules/customer_accounts/widgets/injection/account-status/widget.ts`
  — replace the hardcoded English `description` with the i18n key
  `customer_accounts.widgets.accountStatus.description` (rendered by CrudForm via
  `t(group.description, group.description)`).
- `packages/core/src/modules/customer_accounts/i18n/{en,pl,es,de}.json`
  — add the new `accountStatus.description` key (all locales) and translate the
  `customer_accounts.widgets.invite.*` keys, which existed only with English values
  in pl/es/de.
- Add a regression unit test guarding the i18n contract.

## Non-goals

- Do not translate the unrelated pre-existing English values under
  `customer_accounts.signup.*` / `customer_accounts.settings.*` (separate remediation).
- Do not change the `customer_accounts.injection.company-users` widget.
- Do not touch the pre-existing uncommitted working-tree changes
  (`injection-table.ts`, `module-facts.generated.json`).

## Risks

- Low blast radius: locale JSON + one string literal + one new test. No schema, no
  contract-surface, no runtime-logic change.

## Environment blockers (this run)

- `gh` CLI is not installed and no `GH_TOKEN`/`GITHUB_TOKEN` is available → cannot open
  the PR, apply labels, or post comments from the CLI.
- `git fetch`/`git push` fail with `SSL certificate problem: unable to get local issuer
  certificate` → cannot push the branch from this environment.
- The fix is implemented and validated locally on branch
  `fix/customer-accounts-invite-widget-i18n`; the human must push + open the PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: i18n fix

- [x] 1.1 Route widget `description` through i18n key
- [x] 1.2 Add/translate locale keys in en/pl/es/de
- [x] 1.3 Add regression unit test

### Phase 2: Validation

- [x] 2.1 i18n:check-sync (in sync), i18n:check-values (0 missing), i18n:check-hardcoded (no new flags)
- [x] 2.2 typecheck (exit 0) + unit tests (4 passed, 2 suites)
