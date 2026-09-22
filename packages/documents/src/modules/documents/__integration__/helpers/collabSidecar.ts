import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Realtime Documents specs need a live collaboration sidecar: the editor mounts in a
 * "Connecting…" state and only materialises its CRDT content once it either joins a room or
 * falls back to single-user mode. Selection-driven surfaces (the comment bubble menu, comment
 * anchor selection) are lost across that fallback re-mount, so a spec that drives them must own
 * a sidecar rather than hope one exists.
 *
 * The integration harness does not start one — neither the CLI runner nor the CI workflow — so
 * each realtime spec spawns a disposable loopback sidecar against the same ephemeral database
 * and stops it in teardown. The separate documents-multi-instance gate proves the Redis-backed
 * two-sidecar path; these specs deliberately run single-node.
 */
export type ManagedCollabSidecar = {
  stop: () => Promise<void>
}

export const COLLAB_INTEGRATION_ENABLED = process.env.OM_DOCUMENTS_COLLAB_INTEGRATION === '1'

export const COLLAB_INTEGRATION_SKIP_REASON =
  'Realtime Documents coverage runs with OM_DOCUMENTS_COLLAB_INTEGRATION=1 and a managed sidecar.'

function formatSidecarOutput(chunks: string[]): string {
  return chunks.join('').trim().slice(-4_000)
}

/**
 * Resolve the sidecar entry from the APP under test rather than from a fixed monorepo
 * path. The standalone lane drives a scaffolded app that installs `@open-mercato/*` from
 * npm, so the monorepo `packages/documents/dist` build is both a different copy and a
 * different resolution root: running it against that app root would load two copies of
 * `@open-mercato/shared` (DI container, entity metadata) into one process. Resolving
 * through the app's own `package.json` keeps the sidecar on exactly the code the app
 * runs — and in the monorepo it resolves through the workspace link back to the same
 * `packages/documents/dist` file this helper used before, so that lane is unchanged.
 */
function resolveSidecarEntry(appRoot: string): { entry: string; cwd: string } {
  try {
    const requireFromApp = createRequire(path.join(appRoot, 'package.json'))
    return { entry: requireFromApp.resolve('@open-mercato/documents/collab-server'), cwd: appRoot }
  } catch {
    return {
      entry: path.resolve(process.cwd(), 'packages/documents/dist/server/documents-collab-server.js'),
      cwd: process.cwd(),
    }
  }
}

async function stopSidecarProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }
}

export async function startManagedCollabSidecar(baseUrl: string): Promise<ManagedCollabSidecar> {
  const configuredUrl = process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL?.trim()
  if (!configuredUrl) {
    throw new Error('NEXT_PUBLIC_DOCUMENTS_COLLAB_URL is required when OM_DOCUMENTS_COLLAB_INTEGRATION=1')
  }
  const collabUrl = new URL(configuredUrl)
  if (collabUrl.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(collabUrl.hostname)) {
    throw new Error('Documents collaboration integration requires a loopback ws:// URL')
  }

  const port = collabUrl.port || '80'
  const appRoot = process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato')
  const { entry: serverEntry, cwd: serverCwd } = resolveSidecarEntry(appRoot)
  const output: string[] = []
  const child = spawn(process.execPath, [serverEntry], {
    cwd: serverCwd,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_URL: baseUrl,
      NEXT_PUBLIC_APP_URL: baseUrl,
      DOCUMENTS_COLLAB_ALLOWED_ORIGINS: new URL(baseUrl).origin,
      DOCUMENTS_COLLAB_APP_ROOT: appRoot,
      DOCUMENTS_COLLAB_PORT: port,
      DOCUMENTS_COLLAB_REDIS_URL: '',
      REDIS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))

  const healthUrl = `http://${collabUrl.hostname}:${port}/healthz`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Documents collaboration sidecar exited during startup.\n${formatSidecarOutput(output)}`)
    }
    try {
      const response = await fetch(healthUrl)
      if (response.ok) {
        return { stop: () => stopSidecarProcess(child) }
      }
    } catch {
      // The process may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  await stopSidecarProcess(child)
  throw new Error(`Timed out waiting for documents collaboration sidecar.\n${formatSidecarOutput(output)}`)
}

/**
 * A sidecar is only reusable while nothing else owns the port. When the developer test-env
 * script already runs one (the common local case), reuse it instead of racing for the port.
 */
export async function ensureManagedCollabSidecar(baseUrl: string): Promise<ManagedCollabSidecar | null> {
  const configuredUrl = process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL?.trim()
  if (!configuredUrl) return null
  const collabUrl = new URL(configuredUrl)
  const port = collabUrl.port || '80'
  try {
    const response = await fetch(`http://${collabUrl.hostname}:${port}/healthz`)
    if (response.ok) return null
  } catch {
    // No sidecar listening yet — start our own below.
  }
  return startManagedCollabSidecar(baseUrl)
}
