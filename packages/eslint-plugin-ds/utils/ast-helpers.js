export function isBackendFile(context) {
  const filename = context.filename ?? context.getFilename()
  return filename.includes('/backend/') || filename.includes('\\backend\\')
}

export function importedNamesFrom(node) {
  const names = []
  for (const spec of node.specifiers) {
    if (spec.type === 'ImportSpecifier') names.push(spec.imported.name)
    if (spec.type === 'ImportDefaultSpecifier') names.push(spec.local.name)
  }
  return names
}

export function collectClassStrings(attributeNode) {
  const value = attributeNode.value
  if (!value) return []
  if (value.type === 'Literal' && typeof value.value === 'string') {
    return [{ node: value, text: value.value }]
  }
  if (value.type === 'JSXExpressionContainer') {
    const expr = value.expression
    if (expr?.type === 'Literal' && typeof expr.value === 'string') {
      return [{ node: expr, text: expr.value }]
    }
    if (expr?.type === 'TemplateLiteral') {
      return expr.quasis.map((quasi) => ({ node: quasi, text: quasi.value.raw }))
    }
    if (expr?.type === 'CallExpression') {
      const parts = []
      for (const arg of expr.arguments) {
        if (arg.type === 'Literal' && typeof arg.value === 'string') {
          parts.push({ node: arg, text: arg.value })
        }
        if (arg.type === 'TemplateLiteral') {
          for (const quasi of arg.quasis) parts.push({ node: quasi, text: quasi.value.raw })
        }
      }
      return parts
    }
  }
  return []
}
