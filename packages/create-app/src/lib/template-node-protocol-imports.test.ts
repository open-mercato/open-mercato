import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextConfig } from 'next'

import templateConfig from '../../template/next.config'

type WebpackConfigFn = NonNullable<NextConfig['webpack']>
type WebpackConfigContext = Parameters<WebpackConfigFn>[1]

test('standalone template turbopack resolveAlias rewrites node: builtins used by transpiled packages', () => {
  const resolveAlias = templateConfig.turbopack?.resolveAlias
  assert.ok(resolveAlias, 'expected next.config.ts to declare turbopack.resolveAlias')

  for (const name of ['crypto', 'fs', 'path', 'dns', 'net', 'https', 'os', 'child_process', 'module', 'url']) {
    assert.equal(
      resolveAlias[`node:${name}`],
      name,
      `expected turbopack.resolveAlias to rewrite node:${name} to ${name}`,
    )
  }
})

test('standalone template webpack config rewrites node: requests to bare specifiers on the server target', () => {
  assert.equal(typeof templateConfig.webpack, 'function', 'expected next.config.ts to declare webpack()')

  const pushedPlugins: Array<{ pattern: RegExp; replace: (resource: { request: string }) => void }> = []
  const fakeWebpack = {
    NormalModuleReplacementPlugin: class {
      constructor(pattern: RegExp, replace: (resource: { request: string }) => void) {
        pushedPlugins.push({ pattern, replace })
      }
    },
  }

  const config = { plugins: [] as unknown[] }
  const context = { isServer: true, webpack: fakeWebpack } as unknown as WebpackConfigContext
  const result = templateConfig.webpack!(config, context)

  assert.equal(result, config, 'expected webpack() to return the mutated config')
  assert.equal(pushedPlugins.length, 1, 'expected exactly one NormalModuleReplacementPlugin to be pushed')

  const [{ pattern, replace }] = pushedPlugins
  assert.match('node:crypto', pattern)
  assert.doesNotMatch('crypto', pattern)

  const resource = { request: 'node:crypto' }
  replace(resource)
  assert.equal(resource.request, 'crypto', 'expected node:crypto to be rewritten to crypto')
})

test('standalone template webpack config does not touch the client build', () => {
  const pushedPlugins: unknown[] = []
  const fakeWebpack = {
    NormalModuleReplacementPlugin: class {
      constructor() {
        pushedPlugins.push(this)
      }
    },
  }

  const config = { plugins: [] as unknown[] }
  const context = { isServer: false, webpack: fakeWebpack } as unknown as WebpackConfigContext
  templateConfig.webpack!(config, context)

  assert.equal(pushedPlugins.length, 0, 'expected no plugin to be pushed for the client build')
})
