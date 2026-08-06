// Design-system structural lint — run via `yarn lint:ds`.
// Kept separate from eslint.config.mjs so DS enforcement can run against
// packages/** (which `turbo run lint` does not cover) without dragging the
// full Next.js ruleset over library code. All rules run at `warn` during
// rollout — see docs/design-system/lint-rules.md and
// .ai/specs/2026-07-05-ds-system-guardian-refresh.md. The warn→error
// escalation policy (per rule × module, keyed to the ds-health-check
// counters) lives in
// .ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md.
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'
import next from '@next/eslint-plugin-next'
import omDs from '@open-mercato/eslint-plugin-ds'

// Inline eslint-disable comments in app code reference rules from the main
// Next.js config that are not part of this ruleset. With inline config
// enabled (required for the `om-ds/*` per-line opt-outs that must exist
// before any rule flips to `error`), every directive whose rule ID does not
// resolve becomes an "unknown rule" error — so the foreign plugins are
// registered here with ZERO rules enabled. They exist only so directive rule
// IDs resolve; they contribute no findings.
//
// `@typescript-eslint/*` directives are special-cased: only the parser is
// installed (the eslint-plugin is not a repo dependency), so the directive'd
// rule names resolve against a no-op stub instead.
const noopRule = { meta: { schema: [] }, create: () => ({}) }
const typescriptEslintStub = {
  meta: { name: '@typescript-eslint (directive-resolution stub)' },
  rules: {
    'no-explicit-any': noopRule,
    'no-var-requires': noopRule,
    'no-require-imports': noopRule,
    'no-unsafe-declaration-merging': noopRule,
    'no-empty-function': noopRule,
    'no-unused-vars': noopRule,
  },
}

const plugins = {
  'om-ds': omDs,
  'react-hooks': reactHooks,
  react,
  '@next/next': next,
  '@typescript-eslint': typescriptEslintStub,
}

// Foreign directives are "unused" from this config's perspective by design —
// keep unused-directive reporting off.
const linterOptions = { noInlineConfig: false, reportUnusedDisableDirectives: 'off' }

const languageOptions = {
  parser: tsParser,
  ecmaVersion: 2022,
  sourceType: 'module',
  parserOptions: { ecmaFeatures: { jsx: true } },
}

export default [
  // Global ignores: with the widened positional paths (`packages apps`),
  // ESLint would otherwise lint build artifacts and loose .js files with its
  // implicit default config (where foreign disable directives error again).
  // This ruleset only ever targets .ts/.tsx sources.
  { ignores: ['**/dist/**', '**/*.js', '**/*.mjs', '**/*.cjs'] },
  // The six structural rules keep their backend-only scope — see the rollout
  // baseline in docs/design-system/lint-rules.md.
  {
    files: [
      'packages/core/src/modules/**/backend/**/*.{ts,tsx}',
      'packages/enterprise/src/modules/**/backend/**/*.{ts,tsx}',
      'packages/ui/src/backend/**/*.{ts,tsx}',
    ],
    ignores: ['**/__tests__/**', '**/*.generated.*'],
    linterOptions,
    languageOptions,
    plugins,
    rules: omDs.configs.recommended.rules,
  },
  // `no-legacy-alert-variant` alone gets a wider scope: legacy Alert usages
  // live outside the backend globs (frontend pages, components/, widgets/,
  // and workspaces like checkout, webhooks, sync-akeneo).
  {
    files: ['packages/*/src/**/*.tsx', 'apps/*/src/**/*.tsx', 'packages/create-app/template/src/**/*.tsx'],
    ignores: ['**/__tests__/**', '**/*.generated.*', '**/dist/**'],
    linterOptions,
    languageOptions,
    plugins,
    rules: { 'om-ds/no-legacy-alert-variant': 'warn' },
  },
  // --- escalation overrides — see .ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md ---
  // A module enters this list when its counter for the rule reads zero in two
  // consecutive health reports (.ai/reports/ds-health-*.txt). Entries are
  // removed only when the rule flips to `error` in configs.recommended (all
  // modules at zero). Later blocks win in flat config, so overrides layer
  // cleanly on the `warn` baseline. Example shape:
  //
  // {
  //   files: ['packages/core/src/modules/audit_logs/backend/**/*.{ts,tsx}'],
  //   rules: { 'om-ds/require-empty-state': 'error', 'om-ds/require-status-badge': 'error' },
  // },
]
