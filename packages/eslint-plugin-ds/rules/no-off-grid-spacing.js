const SPACING = '(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)'
const OFF_GRID = new RegExp(`^-?${SPACING}-(?:\\d+\\.5|\\[[^\\]]+\\])$`)

function bareClass(token) {
  let depth = 0
  let cut = 0
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]
    if (char === '[') depth += 1
    else if (char === ']') depth -= 1
    else if (char === ':' && depth === 0) cut = index + 1
  }
  return token.slice(cut).replace(/^!/, '')
}

export function findOffGridSpacing(text) {
  const found = []
  for (const token of text.split(/\s+/)) {
    if (!token) continue
    const bare = bareClass(token)
    if (OFF_GRID.test(bare) && !bare.includes('var(--')) found.push(token)
  }
  return found
}

export const noOffGridSpacing = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow half-step and arbitrary spacing classes; use spacing roles or the 4 px scale',
    },
    messages: {
      offGrid:
        'Off-grid spacing "{{found}}" — use a spacing role (p-card, gap-y-field-stack, ...) or the 4 px scale. See .ai/specs/2026-11-25-component-spacing-standard.md.',
    },
    schema: [],
  },
  create(context) {
    function check(node, text) {
      for (const found of findOffGridSpacing(text)) {
        context.report({ node, messageId: 'offGrid', data: { found } })
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw)
      },
    }
  },
}
