import assert from 'node:assert/strict'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'
import ts from 'typescript-js'
import { buildVariantStory } from '../storybook-variant-source.mjs'

const variantIds = [
  'default',
  'with-icon',
  'quote" backslash\\',
  '<entry>example</entry>',
  '</script>',
  'ampersand&entity&quot;',
  'line\nreturn\rtab\t\0',
  'unicode\u2028separator\u2029',
]

for (const variantId of variantIds) {
  test(`variant source preserves ${JSON.stringify(variantId)} as data`, () => {
    const source = buildVariantStory(variantId)
    const parsed = ts.createSourceFile('variant.stories.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const literals = []
    function visit(node) {
      if (ts.isStringLiteral(node)) literals.push(node)
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    assert.deepEqual(literals.map((node) => node.text), [variantId, variantId, variantId])
    for (const literal of literals) {
      assert.doesNotMatch(literal.getText(parsed), /[<>&\u2028\u2029]/)
    }

    const transformed = transformSync(source, { loader: 'tsx', format: 'cjs', jsxFactory: 'renderElement' })
    const sandbox = {
      module: { exports: {} },
      EntryVariant: () => null,
      entry: {
        variants: [
          { id: 'unrelated', code: 'different example' },
          { id: variantId, code: 'original example' },
        ],
      },
      renderElement: (component, props) => ({ component, props }),
    }
    vm.runInNewContext(transformed.code, sandbox)
    const [story] = Object.values(sandbox.module.exports)
    assert.equal(story.name, variantId)
    assert.equal(story.render().props.variantId, variantId)
    assert.equal(story.parameters.docs.source.code, 'original example')
    assert.equal(source.split('<EntryVariant').length, 2)
    assert.doesNotMatch(source, /<script|<\/script/i)
  })
}

test('ordinary variant export names and lookup behavior remain stable', () => {
  const source = buildVariantStory('with-icon')
  assert.match(source, /^export const VariantWithIcon: Story = /)
  assert.ok(source.includes('variantId={"with-icon"}'))
  assert.ok(source.includes('variant.id === "with-icon"'))
})
