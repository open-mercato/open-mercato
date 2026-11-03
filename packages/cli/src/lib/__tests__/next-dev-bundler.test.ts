import { buildNextDevArgs, resolveNextDevBundler } from '../next-dev-bundler'

describe('Next.js dev bundler selection', () => {
  it('uses Turbopack by default', () => {
    expect(resolveNextDevBundler({})).toBe('turbopack')
    expect(buildNextDevArgs('/app/node_modules/next/dist/bin/next', {}).args).toEqual([
      '/app/node_modules/next/dist/bin/next',
      'dev',
      '--turbopack',
    ])
  })

  it('supports the Webpack fallback for constrained Linux environments', () => {
    const result = buildNextDevArgs('/app/node_modules/next/dist/bin/next', {
      OM_DEV_BUNDLER: 'webpack',
    })

    expect(result).toEqual({
      args: ['/app/node_modules/next/dist/bin/next', 'dev', '--webpack'],
      bundler: 'webpack',
    })
  })

  it('falls back to the safe default for unknown values', () => {
    expect(resolveNextDevBundler({ OM_DEV_BUNDLER: 'unknown' })).toBe('turbopack')
  })
})
