import {
  computeRailwayVariables,
  generateProtectedSecrets,
  parseEnvFile,
} from '../env'

describe('Railway environment variables', () => {
  it('parses common dotenv syntax', () => {
    expect(parseEnvFile(`
# comment
PLAIN=value
export QUOTED="hello world"
SINGLE='x'
`)).toEqual({
      PLAIN: 'value',
      QUOTED: 'hello world',
      SINGLE: 'x',
    })
  })

  it('generates missing protected secrets and preserves existing ones', () => {
    const secrets = generateProtectedSecrets({ AUTH_SECRET: 'existing' })
    expect(secrets.AUTH_SECRET).toBe('existing')
    expect(secrets.JWT_SECRET).toHaveLength(128)
    expect(secrets.TENANT_DATA_ENCRYPTION_FALLBACK_KEY.length).toBeGreaterThan(30)
  })

  it('computes app and worker settings without leaking Railway tokens', () => {
    const variables = computeRailwayVariables({
      env: {
        RAILWAY_API_TOKEN: 'never-upload',
        CUSTOM_SETTING: 'enabled',
      },
      role: 'app',
      workerEnabled: true,
      appUrl: 'https://example.up.railway.app',
      protectedSecrets: {
        AUTH_SECRET: 'auth',
        JWT_SECRET: 'jwt',
        TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'encryption',
      },
    })
    expect(variables).toMatchObject({
      DATABASE_URL: '${{Postgres.DATABASE_URL}}',
      REDIS_URL: '${{Redis.REDIS_URL}}',
      CACHE_STRATEGY: 'redis',
      QUEUE_STRATEGY: 'async',
      AUTO_SPAWN_WORKERS: 'false',
      PORT: '3000',
      APP_URL: 'https://example.up.railway.app',
      CUSTOM_SETTING: 'enabled',
    })
    expect(variables.RAILWAY_API_TOKEN).toBeUndefined()
  })
})
