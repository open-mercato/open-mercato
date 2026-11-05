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

    expect(result.args).toEqual(['/app/node_modules/next/dist/bin/next', 'dev', '--webpack'])
    expect(result.bundler).toBe('webpack')
  })

  it('falls back to the safe default for unknown values', () => {
    expect(resolveNextDevBundler({ OM_DEV_BUNDLER: 'unknown' })).toBe('turbopack')
  })

  it('runs next dev with NODE_ENV=development even when the server environment forces production (#6948)', () => {
    const serverEnvironment: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      APP_URL: 'http://localhost:3000',
      OM_LOG_LEVEL: 'debug',
    }

    const { env } = buildNextDevArgs('/app/node_modules/next/dist/bin/next', serverEnvironment)

    expect(env).toEqual({
      NODE_ENV: 'development',
      APP_URL: 'http://localhost:3000',
      OM_LOG_LEVEL: 'debug',
    })
    expect(serverEnvironment.NODE_ENV).toBe('production')
  })
})
