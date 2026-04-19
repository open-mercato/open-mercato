import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPrefixIndex, scanText } from '../i18n-scanner.mjs'

test('direct t()/translate() calls are detected', () => {
  const text = [
    "const label = t('module.entity.title')",
    "const fallback = translate('module.entity.subtitle', 'Default')",
  ].join('\n')

  const { refs, dynamicCount } = scanText(text, new Set([
    'module.entity.title',
    'module.entity.subtitle',
    'module.entity.unused',
  ]))

  const keys = new Set(refs.map((r) => r.key))
  assert.ok(keys.has('module.entity.title'))
  assert.ok(keys.has('module.entity.subtitle'))
  assert.ok(!keys.has('module.entity.unused'))
  assert.equal(dynamicCount, 0)
})

test('direct-call pattern does not match when t/translate is a suffix of a different identifier', () => {
  // Exercises the lookbehind on pattern 1 in isolation: the surrounding
  // identifier has no dotted string literal, so nothing should fire.
  const text = "const ctx = getTranslationContext(arg)"
  const { refs, dynamicCount } = scanText(text, new Set(['module.entity.title']))
  assert.deepEqual(refs, [])
  // The `(arg)` call does not trigger the dynamic counter either — only
  // t() / translate() invocations are counted.
  assert.equal(dynamicCount, 0)
})

test('labelKey / titleKey property references are detected when the value is a known key', () => {
  const text = [
    "const item = { labelKey: 'module.entity.label', titleKey: 'module.entity.title' }",
    "const unrelated = { somethingKey: 'not.a.real.key' }",
  ].join('\n')

  const { refs } = scanText(text, new Set([
    'module.entity.label',
    'module.entity.title',
  ]))

  // Both patterns 2a (keyPropertyPattern) and 2b (dottedLiteralPattern) can match
  // the same literal; the unique set of recognized keys is what matters.
  const keys = new Set(refs.map((r) => r.key))
  assert.equal(keys.size, 2)
  assert.ok(keys.has('module.entity.label'))
  assert.ok(keys.has('module.entity.title'))
})

test('dotted string literals used as data values are detected when they match a known key', () => {
  const text = [
    "const key = condition ? 'auth.login.requireRolesMessage' : 'auth.login.requireRoleMessage'",
    "const descriptors = ['app.metadata.description']",
    "const route = 'some/file/path.tsx'",
  ].join('\n')

  const { refs } = scanText(text, new Set([
    'auth.login.requireRoleMessage',
    'auth.login.requireRolesMessage',
    'app.metadata.description',
  ]))

  const keys = new Set(refs.map((r) => r.key))
  assert.equal(keys.size, 3)
  assert.ok(keys.has('auth.login.requireRoleMessage'))
  assert.ok(keys.has('auth.login.requireRolesMessage'))
  assert.ok(keys.has('app.metadata.description'))
})

test('template-literal prefix expands to every known key under that prefix', () => {
  const text = [
    'const label = t(`webhooks.deliveries.status.${row.status}`)',
    'const also = translate(`scheduler.trigger_type.${type}`, fallback)',
  ].join('\n')

  const allKeys = new Set([
    'webhooks.deliveries.status.pending',
    'webhooks.deliveries.status.delivered',
    'webhooks.deliveries.status.failed',
    'scheduler.trigger_type.manual',
    'scheduler.trigger_type.cron',
    'unrelated.other.key',
  ])

  const { refs, dynamicCount } = scanText(text, allKeys)
  const used = new Set(refs.map((r) => r.key))

  assert.ok(used.has('webhooks.deliveries.status.pending'))
  assert.ok(used.has('webhooks.deliveries.status.delivered'))
  assert.ok(used.has('webhooks.deliveries.status.failed'))
  assert.ok(used.has('scheduler.trigger_type.manual'))
  assert.ok(used.has('scheduler.trigger_type.cron'))
  assert.ok(!used.has('unrelated.other.key'))
  assert.equal(dynamicCount, 2)
})

test('template-literal prefix also handles suffix after the variable', () => {
  const text = 'const v = t(`foo.bar.${x}.suffix`)'
  const allKeys = new Set([
    'foo.bar.one.suffix',
    'foo.bar.two.suffix',
    'foo.bar.one.other',
    'baz.qux',
  ])

  const { refs } = scanText(text, allKeys)
  const used = new Set(refs.map((r) => r.key))
  assert.ok(used.has('foo.bar.one.suffix'))
  assert.ok(used.has('foo.bar.two.suffix'))
  assert.ok(used.has('foo.bar.one.other'))
  assert.ok(!used.has('baz.qux'))
})

test('dynamicCount counts variable-passed t() calls without producing false references', () => {
  const text = [
    'const key = makeKey()',
    'const val = t(key)',
    'const val2 = translate(getLabel())',
  ].join('\n')

  const { refs, dynamicCount } = scanText(text, new Set(['some.key']))
  assert.deepEqual(refs, [])
  assert.equal(dynamicCount, 2)
})

test('buildPrefixIndex groups keys by every dotted prefix', () => {
  const index = buildPrefixIndex(new Set([
    'a.b.c',
    'a.b.d',
    'a.e',
    'x.y',
  ]))

  assert.deepEqual([...(index.get('a') ?? [])].sort(), ['a.b.c', 'a.b.d', 'a.e'])
  assert.deepEqual([...(index.get('a.b') ?? [])].sort(), ['a.b.c', 'a.b.d'])
  assert.deepEqual([...(index.get('x') ?? [])].sort(), ['x.y'])
  assert.equal(index.has('a.b.c'), false, 'leaf keys have no downstream bucket')
})
