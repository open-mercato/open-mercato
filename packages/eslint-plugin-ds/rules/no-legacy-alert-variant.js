// Guards the legacy Alert `variant` prop after the 2026-07 migration campaign
// (.ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md, WS3).
// The BC shim in packages/ui/src/primitives/alert.tsx still maps `variant` to
// `status`, but in-repo code must use the `status`/`style`/`size` API.
//
// Import tracking: only `Alert` imported from a path ending in
// `primitives/alert` (or the intra-primitives `./alert`) fires the rule — a
// bare name match is deliberately avoided because other libraries
// legitimately expose `Alert variant=`.
//
// Suggestions, not autofix: the per-surface style decision (`light` default
// vs an explicit `lighter` opt-in) is a human call — see the mapping table in
// .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert
// `variant` → `status`".

const LEGACY_VARIANT_TO_STATUS = {
  destructive: 'error',
  info: 'information',
  // `default` maps to the default status — the fix is removing the prop.
  default: null,
  success: 'success',
  warning: 'warning',
}

function isDsAlertImportSource(source) {
  if (typeof source !== 'string') return false
  return source.endsWith('primitives/alert') || source === './alert'
}

export const noLegacyAlertVariant = {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description:
        'Disallow the deprecated Alert `variant` prop — use the `status` (+ `style`/`size`) API',
    },
    messages: {
      legacyVariant:
        'The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`".',
      replaceWithStatus: 'Replace with status="{{status}}"',
      removeProp: 'Remove the prop — `information` is the default status',
    },
    schema: [],
  },
  create(context) {
    const dsAlertLocalNames = new Set()

    return {
      ImportDeclaration(node) {
        if (!isDsAlertImportSource(node.source?.value)) return
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier' && spec.imported.name === 'Alert') {
            dsAlertLocalNames.add(spec.local.name)
          }
        }
      },
      JSXOpeningElement(node) {
        if (node.name?.type !== 'JSXIdentifier') return
        if (!dsAlertLocalNames.has(node.name.name)) return
        const attr = node.attributes.find(
          (a) => a.type === 'JSXAttribute' && a.name?.name === 'variant',
        )
        if (!attr) return

        const suggest = []
        const value = attr.value
        if (
          value?.type === 'Literal' &&
          typeof value.value === 'string' &&
          Object.prototype.hasOwnProperty.call(LEGACY_VARIANT_TO_STATUS, value.value)
        ) {
          const status = LEGACY_VARIANT_TO_STATUS[value.value]
          const sourceCode = context.sourceCode ?? context.getSourceCode()
          if (status === null) {
            suggest.push({
              messageId: 'removeProp',
              fix(fixer) {
                const before = sourceCode.getTokenBefore(attr)
                return fixer.removeRange([before.range[1], attr.range[1]])
              },
            })
          } else {
            suggest.push({
              messageId: 'replaceWithStatus',
              data: { status },
              fix(fixer) {
                return fixer.replaceText(attr, `status="${status}"`)
              },
            })
          }
        }
        // Dynamic `variant={expr}` gets the report without a suggestion — the
        // expression's source values need a manual, enumerated migration.
        context.report({ node: attr, messageId: 'legacyVariant', suggest })
      },
    }
  },
}
