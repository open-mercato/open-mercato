import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline/promises'
import { parseEnv } from 'node:util'

function settingsFor(projectDir, envFiles, env) {
  const settings = {}
  for (const file of [...envFiles, path.join(projectDir, '.env')]) {
    try { Object.assign(settings, parseEnv(fs.readFileSync(file, 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read database configuration before authorizing writes.') }
  }
  return { ...settings, ...env }
}

function loadPostgres(projectDir) {
  for (const manifest of [path.join(projectDir, 'package.json'), path.join(projectDir, 'node_modules', '@open-mercato', 'cli', 'package.json'), path.join(projectDir, '..', '..', 'packages', 'cli', 'package.json')]) {
    try { return createRequire(manifest)('pg') }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }
  }
  throw new Error('Install project dependencies before authorizing database writes: yarn install.')
}

export function collectRemoteDatabaseFlags(argv) {
  const flags = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument.startsWith('--allow-remote-database=')) flags.push(argument)
    else if (argument === '--allow-remote-database') {
      flags.push(argument)
      if (argv[index + 1] && !argv[index + 1].startsWith('-')) flags.push(argv[++index])
    }
  }
  return flags
}

export function resolveDatabaseWriteTarget({ projectDir = process.cwd(), envFiles = [], env = process.env, databaseUrl, loadModule = loadPostgres } = {}) {
  const settings = settingsFor(projectDir, envFiles, env)
  const connectionString = databaseUrl ?? settings.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL must be configured before database writes.')
  let parameters
  try {
    const { Client } = loadModule(projectDir)
    parameters = new Client({ connectionString, host: settings.PGHOST, port: settings.PGPORT, database: settings.PGDATABASE, user: settings.PGUSER }).connectionParameters
  } catch { throw new Error('Cannot resolve the PostgreSQL write target. Check DATABASE_URL and install project dependencies.') }
  const host = String(parameters.host ?? '').toLowerCase()
  const database = String(parameters.database ?? '')
  const port = Number(parameters.port)
  if (!host || !database || !Number.isInteger(port) || port < 1 || port > 65535 || /[\x00-\x1f\x7f]/.test(host + database)) throw new Error('Cannot resolve a valid PostgreSQL write target from DATABASE_URL.')
  const plainHost = host.replace(/^\[|\]$/g, '')
  const local = plainHost === 'localhost' || plainHost === '::1' || (net.isIP(plainHost) === 4 && plainHost.split('.')[0] === '127') || plainHost.startsWith('/')
  const renderedHost = net.isIP(plainHost) === 6 ? `[${plainHost}]` : host
  return {
    remote: !local,
    target: `${renderedHost}:${port}/${encodeURIComponent(database)}`,
    connectionEnv: { DATABASE_URL: connectionString, PGHOST: String(parameters.host), PGPORT: String(parameters.port), PGDATABASE: String(parameters.database), PGUSER: String(parameters.user ?? ''), PGPASSWORD: typeof parameters.password === 'string' ? parameters.password : '' },
  }
}

export async function assertDatabaseWriteAllowed({ argv = [], input = process.stdin, output = process.stdout, ...options } = {}) {
  const resolved = resolveDatabaseWriteTarget(options)
  if (!resolved.remote) return resolved
  const flags = collectRemoteDatabaseFlags(argv)
  let acknowledgement
  let requested = false
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index].startsWith('--allow-remote-database=')) { requested = true; acknowledgement = flags[index].slice('--allow-remote-database='.length) }
    else if (flags[index] === '--allow-remote-database') { requested = true; acknowledgement = flags[index + 1] && !flags[index + 1].startsWith('-') ? flags[++index] : undefined }
  }
  if (requested && acknowledgement === undefined && input.isTTY && output.isTTY && !options.env?.CI) {
    const prompt = createInterface({ input, output })
    try { acknowledgement = await prompt.question(`Remote database writes affect ${resolved.target}. Type that exact target to authorize migrations and initialization: `) }
    finally { prompt.close() }
  }
  if (!requested || acknowledgement !== resolved.target) {
    throw new Error(`Remote database writes are blocked for ${resolved.target}. To authorize this exact target, pass --allow-remote-database=${resolved.target}. Local service reuse remains the default; no database changes were made.`)
  }
  return { ...resolved, argument: `--allow-remote-database=${resolved.target}` }
}
