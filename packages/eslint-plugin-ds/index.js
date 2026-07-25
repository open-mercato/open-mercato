import { requireEmptyState } from './rules/require-empty-state.js'
import { requirePageWrapper } from './rules/require-page-wrapper.js'
import { noRawTable } from './rules/no-raw-table.js'
import { requireLoadingState } from './rules/require-loading-state.js'
import { requireStatusBadge } from './rules/require-status-badge.js'
import { noHardcodedStatusColors } from './rules/no-hardcoded-status-colors.js'

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
  },
}

// Flat-config preset: all rules at `warn` (rollout severity for existing code —
// see docs/design-system/lint-rules.md L.0). Escalate per-rule to `error` once
// the corresponding metric in .ai/reports/ds-health-*.txt allows it.
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
    },
  },
}

export default plugin
