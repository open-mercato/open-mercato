import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import {
  computeRailwayVariables,
  generateProtectedSecrets,
  parseEnvFile,
  writeGeneratedSecrets,
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
    expect(validatePassword(secrets.OM_INIT_SUPERADMIN_PASSWORD, getPasswordPolicy({})).ok).toBe(true)
    expect(generateProtectedSecrets({}).OM_INIT_SUPERADMIN_PASSWORD).not.toBe(secrets.OM_INIT_SUPERADMIN_PASSWORD)
  })

  it('preserves an existing bootstrap password', () => {
    const password = 'Operator-8sW!k3zR'
    expect(generateProtectedSecrets({ OM_INIT_SUPERADMIN_PASSWORD: password }).OM_INIT_SUPERADMIN_PASSWORD).toBe(password)
  })

  it.each(['', '  '])('generates a bootstrap password for a blank value', (value) => {
    const password = generateProtectedSecrets({ OM_INIT_SUPERADMIN_PASSWORD: value }).OM_INIT_SUPERADMIN_PASSWORD
    expect(validatePassword(password, getPasswordPolicy({})).ok).toBe(true)
  })

  it('persists generated bootstrap credentials in an ignored env file and preserves them on rerun', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'railway-bootstrap-env-'))
    try {
      execFileSync('git', ['init', '--quiet', cwd])
      writeFileSync(join(cwd, '.gitignore'), '.env\n')
      const envFile = join(cwd, '.env')
      writeFileSync(envFile, 'OM_INIT_SUPERADMIN_PASSWORD=\nCUSTOM_SETTING=enabled\n')
      const secrets = generateProtectedSecrets(parseEnvFile(readFileSync(envFile, 'utf8')))
      writeGeneratedSecrets(envFile, secrets)
      const contents = readFileSync(envFile, 'utf8')
      const saved = parseEnvFile(contents)
      expect(saved.OM_INIT_SUPERADMIN_PASSWORD).toBe(secrets.OM_INIT_SUPERADMIN_PASSWORD)
      expect(saved.CUSTOM_SETTING).toBe('enabled')
      writeGeneratedSecrets(envFile, generateProtectedSecrets(saved))
      expect(readFileSync(envFile, 'utf8')).toBe(contents)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
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
        OM_INIT_SUPERADMIN_PASSWORD: 'Operator-8sW!k3zR',
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
      OM_INIT_SUPERADMIN_PASSWORD: 'Operator-8sW!k3zR',
    })
    expect(variables.RAILWAY_API_TOKEN).toBeUndefined()
  })
})
