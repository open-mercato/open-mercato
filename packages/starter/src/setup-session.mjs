// Ownership and default service choice for `yarn setup` in the monorepo.
//
// The canonical workspace dev-session guard lives in the checkout
// (scripts/dev-session-guard.mjs, also used by scripts/dev.mjs). The starter
// claims it BEFORE it writes .env, configures services or touches Compose, so
// a second setup in an active checkout stops without disturbing the running
// session. The token travels to the dev runner through childEnv.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

import { runCompose } from './compose.mjs'
import { resolveStackPorts } from './constants.mjs'
import { parseComposePsOutput, selectDefaultServiceMode } from './infra-preflight.mjs'
import { verifyServiceConnections } from './service-connections.mjs'

// Works before the first `yarn install`, unlike `yarn setup --no-infra`.
export const FRESH_CLONE_NO_INFRA_COMMAND = 'node packages/starter/bin/om-start.mjs up --no-infra'

export async function acquireSetupSession(repoRoot, { mode = 'setup:hybrid', role = 'starter' } = {}) {
  const guardPath = path.join(repoRoot, 'scripts', 'dev-session-guard.mjs')
  if (!fs.existsSync(guardPath)) return null
  const { acquireDevSession } = await import(pathToFileURL(guardPath).href)
  return acquireDevSession({ workspaceRoot: repoRoot, mode, role })
}

function readEnvFile(file) {
  try { return parseEnv(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

// Same precedence the app uses, with the shipped examples filling the gaps a
// fresh clone has before the env-files step writes .env.
export function readServiceSettings(repoRoot, env = process.env) {
  const appDir = path.join(repoRoot, 'apps', 'mercato')
  return {
    ...readEnvFile(path.join(repoRoot, '.env.example')),
    ...readEnvFile(path.join(appDir, '.env.example')),
    ...readEnvFile(path.join(repoRoot, '.env')),
    ...readEnvFile(path.join(appDir, '.env')),
    ...env,
  }
}

export function selectStarterServiceMode(repoRoot, {
  env = process.env,
  select = selectDefaultServiceMode,
  verify = verifyServiceConnections,
  runComposeImpl = runCompose,
} = {}) {
  const settings = readServiceSettings(repoRoot, env)
  const ports = resolveStackPorts(repoRoot, env)
  return select({
    databaseUrl: settings.DATABASE_URL,
    services: [
      { service: 'postgres', port: ports.postgres },
      { service: 'redis', port: ports.redis },
      { service: 'meilisearch', port: ports.meilisearch },
    ],
    verifyConnections: () => verify({
      projectDir: path.join(repoRoot, 'apps', 'mercato'),
      envFiles: [path.join(repoRoot, '.env')],
      env: settings,
      timeoutMs: 3000,
      log: () => {},
    }),
    listOwnContainers: () => {
      try {
        const ps = runComposeImpl(repoRoot, ['ps', '--all', '--format', 'json'], { stdio: 'pipe' })
        if ((ps.status ?? 1) !== 0) return null
        return new Set(parseComposePsOutput(ps.stdout).map((entry) => String(entry?.Name ?? '').replace(/^\//, '')).filter(Boolean))
      } catch {
        return null
      }
    },
  })
}
