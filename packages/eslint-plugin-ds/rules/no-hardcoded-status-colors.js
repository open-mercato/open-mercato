import { collectClassStrings } from '../utils/ast-helpers.js'

// Mirrors .ai/skills/om-ds-guardian/references/token-mapping.md
const REPLACEMENTS = {
  'text-red-500': 'text-status-error-icon',
  'text-red-600': 'text-status-error-text',
  'text-red-700': 'text-status-error-text',
  'text-red-800': 'text-status-error-text',
  'text-red-900': 'text-status-error-text',
  'bg-red-50': 'bg-status-error-bg',
  'bg-red-100': 'bg-status-error-bg',
  'bg-red-600': 'bg-destructive (solid button bg) or bg-status-error-icon',
  'border-red-200': 'border-status-error-border',
  'border-red-300': 'border-status-error-border',
  'border-red-500': 'border-status-error-border',
  'text-green-500': 'text-status-success-text',
  'text-green-600': 'text-status-success-text',
  'text-green-700': 'text-status-success-text',
  'text-green-800': 'text-status-success-text',
  'bg-green-50': 'bg-status-success-bg',
  'bg-green-100': 'bg-status-success-bg',
  'border-green-200': 'border-status-success-border',
  'border-green-300': 'border-status-success-border',
  'border-green-500': 'border-status-success-border',
  'text-emerald-300': 'text-status-success-icon',
  'text-emerald-600': 'text-status-success-text',
  'text-emerald-700': 'text-status-success-text',
  'text-emerald-800': 'text-status-success-text',
  'text-emerald-900': 'text-status-success-text',
  'bg-emerald-50': 'bg-status-success-bg',
  'bg-emerald-100': 'bg-status-success-bg',
  'bg-emerald-500': 'bg-status-success-icon',
  'bg-emerald-600': 'bg-status-success-icon',
  'border-emerald-200': 'border-status-success-border',
  'border-emerald-300': 'border-status-success-border',
  'text-amber-500': 'text-status-warning-icon',
  'text-amber-600': 'text-status-warning-text',
  'text-amber-800': 'text-status-warning-text',
  'text-amber-950': 'text-status-warning-text',
  'bg-amber-50': 'bg-status-warning-bg',
  'bg-yellow-50': 'bg-status-warning-bg',
  'text-yellow-600': 'text-status-warning-text',
  'border-amber-200': 'border-status-warning-border',
  'border-amber-500': 'border-status-warning-border',
  'text-blue-500': 'text-status-info-icon',
  'text-blue-600': 'text-status-info-text',
  'text-blue-700': 'text-status-info-text',
  'text-blue-800': 'text-status-info-text',
  'text-blue-900': 'text-status-info-text',
  'bg-blue-50': 'bg-status-info-bg',
  'bg-blue-100': 'bg-status-info-bg',
  'bg-blue-600': 'bg-status-info-icon',
  'border-blue-200': 'border-status-info-border',
  'border-blue-500': 'border-status-info-border',
  'text-sky-900': 'text-status-info-text',
}

const GENERIC_PATTERN = /^(?:text|bg|border)-(?:red|green|emerald|amber|yellow|blue|sky|rose|lime|orange)-\d{2,3}(?:\/\d{1,3})?$/

export const noHardcodedStatusColors = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded Tailwind status colors — use semantic DS tokens',
    },
    messages: {
      hardcodedColor:
        'Hardcoded status color "{{found}}" — use a semantic token instead: {{replacement}}. See .ai/ds-rules.md and token-mapping.md.',
    },
    schema: [],
  },
  create(context) {
    function checkClassString(node, classStr) {
      for (const cls of classStr.split(/\s+/)) {
        if (!cls) continue
        const bare = cls.replace(/^(?:hover|focus|focus-visible|active|disabled|dark|group-hover):/, '')
        const known = REPLACEMENTS[bare]
        if (known) {
          context.report({ node, messageId: 'hardcodedColor', data: { found: cls, replacement: known } })
        } else if (GENERIC_PATTERN.test(bare)) {
          context.report({
            node,
            messageId: 'hardcodedColor',
            data: { found: cls, replacement: '{property}-status-{status}-{role}' },
          })
        }
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'className') return
        for (const { node: strNode, text } of collectClassStrings(node)) {
          checkClassString(strNode, text)
        }
      },
    }
  },
}
