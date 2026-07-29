// Design-system structural lint — run via `yarn lint:ds`.
// Kept separate from eslint.config.mjs so DS enforcement can run against
// packages/** (which `turbo run lint` does not cover) without dragging the
// full Next.js ruleset over library code. All rules run at `warn` during
// rollout — see docs/design-system/lint-rules.md and
// .ai/specs/2026-07-05-ds-system-guardian-refresh.md.
import tsParser from '@typescript-eslint/parser'
import omDs from '@open-mercato/eslint-plugin-ds'

export default [
  {
    files: [
      'packages/core/src/modules/**/backend/**/*.{ts,tsx}',
      'packages/enterprise/src/modules/**/backend/**/*.{ts,tsx}',
      'packages/ui/src/backend/**/*.{ts,tsx}',
    ],
    ignores: ['**/__tests__/**', '**/*.generated.*'],
    // Inline eslint-disable comments in app code reference rules from the main
    // Next.js config (react-hooks/*, @next/*) that are not loaded here — with
    // inline config on, every such directive becomes an "unknown rule" error.
    // DS findings are warn-level during rollout, so per-line opt-outs are not
    // needed yet; revisit when severities flip to error.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'om-ds': omDs },
    rules: omDs.configs.recommended.rules,
  },
]
