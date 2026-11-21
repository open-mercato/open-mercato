import assert from 'node:assert/strict'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'
import { buildVariantStory } from '../storybook-variant-source.mjs'

for (const variantId of ['default', 'with-icon', 'quote" backslash\\', '</script><script>alert(1)</script>', '" /><script>alert(1)</script><EntryVariant variantId="', 'ampersand&entity&quot;', 'line\nreturn\rtab\t\0', 'unicode\u2028separator\u2029']) {
  test(`variant source preserves ${JSON.stringify(variantId)} as data`, () => {
    const source = buildVariantStory(variantId)
    const nameLiteral = source.match(/name: (.*?), render: /)[1]
    const attributeLiteral = source.match(/variantId=\{(.*?)\} \/>/)[1]
    const lookupLiteral = source.match(/variant.id === (.*?)\)!/)[1]
    for (const literal of [nameLiteral, attributeLiteral, lookupLiteral]) {
      assert.equal(vm.runInNewContext(literal), variantId)
      assert.doesNotMatch(literal, /[<>&\u2028\u2029]/)
    }
    const transformed = transformSync(source, { loader: 'tsx', format: 'cjs', jsxFactory: 'renderElement' })
    const sandbox = {
      module: { exports: {} },
      EntryVariant: () => null,
      entry: { variants: [{ id: variantId, code: 'original example' }] },
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
