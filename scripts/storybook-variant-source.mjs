import ts from 'typescript-js'

const storyTemplate = ts.createSourceFile(
  'variant.stories.tsx',
  `export const VariantExport: Story = {
  name: variantIdValue,
  render: () => <EntryVariant entry={entry} variantId={variantIdValue} />,
  parameters: {
    docs: {
      source: { code: entry.variants.find(variant => variant.id === variantIdValue)!.code },
    },
  },
}`,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true })

function createVariantIdLiteral(variantId) {
  const encoded = JSON.stringify(variantId).replace(/[<>&\u2028\u2029]/g, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ))
  const literalSource = ts.createSourceFile('variant-id.ts', encoded, ts.ScriptTarget.Latest, true)
  return ts.factory.createStringLiteralFromNode(literalSource.statements[0].expression)
}

export function buildVariantStory(variantId) {
  const name = variantId.split(/[^a-zA-Z0-9]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  const storyExport = ts.factory.createIdentifier(`Variant${name}`)
  const variantIdLiteral = createVariantIdLiteral(variantId)
  const transformed = ts.transform(storyTemplate, [(context) => {
    function visit(node) {
      if (ts.isIdentifier(node)) {
        if (node.text === 'VariantExport') return storyExport
        if (node.text === 'variantIdValue') return variantIdLiteral
      }
      return ts.visitEachChild(node, visit, context)
    }
    return (sourceFile) => ts.visitNode(sourceFile, visit)
  }])

  try {
    return printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0].statements[0], storyTemplate)
  } finally {
    transformed.dispose()
  }
}
