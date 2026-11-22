import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { resolveDockerHostFromContext } from '../../packages/cli/src/lib/testing/runtime-utils'
import { VALID_PRESET_IDS } from '../../packages/create-app/src/lib/starter-presets'
import { createAppBin, createStandaloneInstallEnv, runCommand, VERDACCIO_URL } from './verdaccio'

export async function runStandalonePresetInitialization(rootDir: string): Promise<void> {
  const dockerConfig = await resolveDockerHostFromContext('preset-init')
  if (dockerConfig) {
    process.env.DOCKER_HOST = dockerConfig.dockerHost
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = dockerConfig.socketOverride
  }

  const requireFromCli = createRequire(path.join(rootDir, 'packages', 'cli', 'package.json'))
  const { GenericContainer, Wait } = requireFromCli('testcontainers') as typeof import('testcontainers')
  const dbUser = 'mercato'
  const dbPassword = randomBytes(24).toString('hex')
  let database: import('testcontainers').StartedTestContainer | undefined
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-preset-init-'))
  try {
    database = await new GenericContainer(process.env.OM_INTEGRATION_POSTGRES_IMAGE?.trim() || 'pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: dbUser, POSTGRES_PASSWORD: dbPassword })
      .withExposedPorts(5432)
      .withHealthCheck({ test: ['CMD', 'pg_isready', '-h', '127.0.0.1'], interval: 1_000, timeout: 2_000, retries: 30 })
      .withWaitStrategy(Wait.forHealthCheck())
      .start()

    const installEnv = createStandaloneInstallEnv(tempRoot)
    const failures: Error[] = []

    for (const [index, preset] of VALID_PRESET_IDS.entries()) {
      console.log(`\nChecking standalone preset: ${preset}`)
      try {
        const appDir = path.join(tempRoot, preset)
        runCommand(process.execPath, [createAppBin(rootDir), appDir, '--preset', preset,
          '--registry', VERDACCIO_URL, '--skip-agentic-setup', '--no-init-git'], { cwd: rootDir })

        const databaseName = `preset_${index}`
        const created = await database.exec(['createdb', '-U', dbUser, databaseName])
        if (created.exitCode !== 0) throw new Error(`Could not create the isolated database: ${created.output}`)

        const databaseUrl = new URL('postgres://localhost')
        databaseUrl.hostname = database.getHost()
        databaseUrl.port = String(database.getMappedPort(5432))
        databaseUrl.username = dbUser
        databaseUrl.password = dbPassword
        databaseUrl.pathname = databaseName

        const env: NodeJS.ProcessEnv = {
          ...installEnv,
          DATABASE_URL: databaseUrl.toString(),
          NODE_ENV: 'development',
          TENANT_DATA_ENCRYPTION_FALLBACK_KEY: randomBytes(32).toString('hex'),
          CACHE_STRATEGY: 'memory',
          QUEUE_STRATEGY: 'local',
          REDIS_URL: '',
          OM_DISABLE_EMAIL_DELIVERY: '1',
          OM_ENABLE_ENTERPRISE_MODULES: 'false',
          OM_INIT_SUPERADMIN_EMAIL: 'preset-admin@example.invalid',
          OM_INIT_SUPERADMIN_PASSWORD: 'PresetSmokeTest-Only-1!',
          OM_INIT_ADMIN_PASSWORD: 'PresetSmokeTest-Only-2!',
          OM_INIT_EMPLOYEE_PASSWORD: 'PresetSmokeTest-Only-3!',
        }
        for (const command of ['install', 'generate', 'db:migrate', 'initialize']) {
          runCommand('yarn', [command], { cwd: appDir, env })
        }

        const initialized = await database.exec(['psql', '-XAt', '-U', dbUser, '-d', databaseName, '-c',
          'select exists (select 1 from users where deleted_at is null)'])
        if (initialized.exitCode !== 0 || initialized.output.trim() !== 't') {
          throw new Error('Initialization did not create an active user')
        }
        console.log(`Preset ${preset} initialized successfully`)
      } catch (error) {
        failures.push(new Error(`Preset ${preset} failed: ${error instanceof Error ? error.message : String(error)}`))
      }
    }

    if (failures.length > 0) throw new AggregateError(failures, 'Standalone preset initialization failed')
  } finally {
    try {
      await database?.stop()
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
}
