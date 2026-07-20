import { requireEmptyState } from './rules/require-empty-state.js'
import { requirePageWrapper } from './rules/require-page-wrapper.js'
import { noRawTable } from './rules/no-raw-table.js'
import { requireLoadingState } from './rules/require-loading-state.js'
import { requireStatusBadge } from './rules/require-status-badge.js'
import { noHardcodedStatusColors } from './rules/no-hardcoded-status-colors.js'
import { noLegacyAlertVariant } from './rules/no-legacy-alert-variant.js'

const plugin = {
  meta: {
    name: '@open-mercato/eslint-plugin-ds',
    version: '0.6.5',
  },
  rules: {
    'require-empty-state': requireEmptyState,
    'require-page-wrapper': requirePageWrapper,
    'no-raw-table': noRawTable,
    'require-loading-state': requireLoadingState,
    'require-status-badge': requireStatusBadge,
    'no-hardcoded-status-colors': noHardcodedStatusColors,
    'no-legacy-alert-variant': noLegacyAlertVariant,
  },
}

// Flat-config preset: all rules at `warn` (rollout severity for existing code —
// see docs/design-system/lint-rules.md L.0). Escalation to `error` happens per
// rule × module via the override blocks in eslint.ds.config.mjs once the
// module's counter reads zero in two consecutive .ai/reports/ds-health-*.txt
// reports — see .ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md
// (Workstream 2). When every module is at zero for a rule, its per-module
// entries are deleted and the severity flips to `error` here — the terminal
// state per rule.
plugin.configs = {
  recommended: {
    plugins: { 'om-ds': plugin },
    rules: {
      'om-ds/require-empty-state': 'warn',
      'om-ds/require-page-wrapper': 'warn',
      'om-ds/no-raw-table': 'warn',
      'om-ds/require-loading-state': 'warn',
      'om-ds/require-status-badge': 'warn',
      'om-ds/no-hardcoded-status-colors': 'warn',
      'om-ds/no-legacy-alert-variant': 'warn',
    },
  },
}

export default plugin
