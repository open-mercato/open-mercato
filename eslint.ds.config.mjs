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
import omDs, { noNestedFramesScope, preferBusinessBlockScope } from '@open-mercato/eslint-plugin-ds'

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
  // Spacing standard (.ai/specs/2026-11-25-component-spacing-standard.md):
  // primitives and blocks carry no half-step or arbitrary spacing. Structural
  // geometry (switch track, file-format artwork, avatar overlap) opts out per
  // line with an eslint-disable-next-line comment that says why.
  {
    files: ['packages/ui/src/primitives/**/*.tsx', 'packages/ui/src/blocks/**/*.tsx'],
    ignores: ['**/__tests__/**', '**/*.generated.*'],
    linterOptions,
    languageOptions,
    plugins,
    rules: { 'om-ds/no-off-grid-spacing': 'error' },
  },
  // Business blocks (docs/design-system/lint-rules.md L.7b): advisory. Module
  // code that hand-builds a surface a block already covers gets a warning.
  // Known hand-built surfaces sit in the baseline
  // packages/eslint-plugin-ds/baselines/prefer-business-block.json and stay
  // quiet until they adopt the block; only additions speak up.
  {
    files: preferBusinessBlockScope.files,
    ignores: preferBusinessBlockScope.ignores,
    linterOptions,
    languageOptions,
    plugins,
    rules: { 'om-ds/prefer-business-block': ['warn', { baseline: preferBusinessBlockScope.baseline }] },
  },
  // Frames, one level only (docs/design-system/lint-rules.md L.7c, rule text in
  // .ai/ds-rules.md): advisory. A bordered rounded surface nested in another
  // one gets a warning. Nesting that exists today sits in the baseline
  // packages/eslint-plugin-ds/baselines/no-nested-frames.json and stays quiet
  // until it is flattened; only additions speak up. The design_system gallery
  // is out of scope because its examples show framed components in frames.
  {
    files: noNestedFramesScope.files,
    ignores: noNestedFramesScope.ignores,
    linterOptions,
    languageOptions,
    plugins,
    rules: { 'om-ds/no-nested-frames': ['warn', { baseline: noNestedFramesScope.baseline }] },
  },
  // --- escalation overrides — see .ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md ---
  // A module enters this list when its counter for the rule reads zero in two
  // consecutive runs of the rolling report .ai/reports/ds-health-latest.txt —
  // the current file and its previous committed revision:
  //   git show "$(git log -2 --format=%H -- .ai/reports/ds-health-latest.txt \
  //     | tail -1):.ai/reports/ds-health-latest.txt"
  // Never match on a ds-health-*.txt glob: it also selects the April 2026
  // ds-health-baseline-*.txt anchor, whose metric definitions predate the
  // 2026-07-17 HC_PATTERN/scan-root change and are not comparable. Entries are
  // removed only when the rule flips to `error` in configs.recommended (all
  // modules at zero). Later blocks win in flat config, so overrides layer
  // cleanly on the `warn` baseline. Example shape:
  //
  // {
  //   files: ['packages/core/src/modules/audit_logs/backend/**/*.{ts,tsx}'],
  //   rules: { 'om-ds/require-empty-state': 'error', 'om-ds/require-status-badge': 'error' },
  // },
  {
    files: ['packages/core/src/modules/customer_groups/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.generated.*'],
    linterOptions,
    languageOptions,
    plugins,
    rules: {
      'om-ds/require-empty-state': 'error',
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'error',
      'om-ds/require-status-badge': 'error',
      'om-ds/no-hardcoded-status-colors': 'error',
      'om-ds/no-legacy-alert-variant': 'error',
    },
  },
  {
    files: ['packages/core/src/modules/phone_calls/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.generated.*'],
    linterOptions,
    languageOptions,
    plugins,
    rules: {
      'om-ds/require-empty-state': 'error',
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'error',
      'om-ds/require-status-badge': 'error',
      'om-ds/no-hardcoded-status-colors': 'error',
      'om-ds/no-legacy-alert-variant': 'error',
    },
  },
  {
    files: ['packages/core/src/modules/forms/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.generated.*'],
    linterOptions,
    languageOptions,
    plugins,
    rules: {
      'om-ds/require-empty-state': 'error',
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'error',
      'om-ds/require-status-badge': 'error',
      'om-ds/no-hardcoded-status-colors': 'error',
      'om-ds/no-legacy-alert-variant': 'error',
    },
  },
  {
    files: ['packages/tillio/src/modules/tillio/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.generated.*'],
    linterOptions,
    languageOptions,
    plugins,
    rules: {
      'om-ds/require-empty-state': 'error',
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'error',
      'om-ds/require-status-badge': 'error',
      'om-ds/no-hardcoded-status-colors': 'error',
      'om-ds/no-legacy-alert-variant': 'error',
    },
  },
]
