import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertNode24Runtime,
  getFreePort,
  getPreferredPort,
  isPortAvailable,
  isEndpointResponsive,
} from '../packages/cli/src/lib/testing/runtime-utils'

type DevEphemeralInstance = {
  id: string
  pid: number
  port: number
  baseUrl: string
  backendUrl: string
  cwd: string
  startedAt: string
}

type DevEphemeralState = {
  version: 1
  instances: DevEphemeralInstance[]
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRootDirectory = path.resolve(scriptDirectory, '..')
const appDirectory = path.join(projectRootDirectory, 'apps', 'mercato')
const envExamplePath = path.join(appDirectory, '.env.example')
const envPath = path.join(appDirectory, '.env')
const devInstancesFilePath = path.join(projectRootDirectory, '.ai', 'dev-ephemeral-envs.json')
const preferredPort = Number.parseInt(process.env.DEV_EPHEMERAL_PREFERRED_PORT ?? '', 10)
const minimumEphemeralPort = 5000
const maximumPort = 65535
const randomPortAttempts = 100
const startupTimeoutMs = 120000
const readinessProbeIntervalMs = 1000
const probeTimeoutMs = 1500

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function ensureEnvFile(): Promise<void> {
  if (await fileExists(envPath)) {
    console.log('[dev:ephemeral] Reusing existing apps/mercato/.env file.')
    return
  }

  await copyFile(envExamplePath, envPath)
  console.log('[dev:ephemeral] Created apps/mercato/.env from apps/mercato/.env.example.')
}

function runCommand(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRootDirectory,
      stdio: 'inherit',
      env: process.env,
      shell: false,
      ...options,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}.`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

async function resolvePort(): Promise<number> {
  if (Number.isFinite(preferredPort) && preferredPort >= minimumEphemeralPort && preferredPort <= maximumPort) {
    return getPreferredPort(preferredPort, 'dev:ephemeral')
  }

  if (Number.isFinite(preferredPort) && (preferredPort < minimumEphemeralPort || preferredPort > maximumPort)) {
    console.log(
      `[dev:ephemeral] Ignoring DEV_EPHEMERAL_PREFERRED_PORT=${preferredPort}. Value must be between ${minimumEphemeralPort} and ${maximumPort}.`,
    )
  }

  for (let attempt = 0; attempt < randomPortAttempts; attempt += 1) {
    const candidatePort = Math.floor(Math.random() * (maximumPort - minimumEphemeralPort + 1)) + minimumEphemeralPort
    if (await isPortAvailable(candidatePort)) {
      return candidatePort
    }
  }

  for (let attempt = 0; attempt < randomPortAttempts; attempt += 1) {
    const fallbackPort = await getFreePort()
    if (fallbackPort >= minimumEphemeralPort) {
      return fallbackPort
    }
  }

  throw new Error(`Unable to allocate a free dev ephemeral port >= ${minimumEphemeralPort}.`)
}

async function readDevInstancesState(): Promise<DevEphemeralState> {
  let rawState = ''
  try {
    rawState = await readFile(devInstancesFilePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, instances: [] }
    }
    throw error
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<DevEphemeralState>
    if (!parsedState || typeof parsedState !== 'object' || !Array.isArray(parsedState.instances)) {
      return { version: 1, instances: [] }
    }
    return {
      version: 1,
      instances: parsedState.instances as DevEphemeralInstance[],
    }
  } catch {
    return { version: 1, instances: [] }
  }
}

async function writeDevInstancesState(state: DevEphemeralState): Promise<void> {
  await mkdir(path.dirname(devInstancesFilePath), { recursive: true })
  await writeFile(devInstancesFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return true
    }
    return false
  }
}

async function pruneStaleDevInstances(): Promise<void> {
  const state = await readDevInstancesState()
  const retainedInstances: DevEphemeralInstance[] = []
  let removedCount = 0

  for (const instance of state.instances) {
    if (!instance || typeof instance !== 'object') {
      removedCount += 1
      continue
    }

    const instancePid = Number.parseInt(String(instance.pid ?? ''), 10)
    const instanceBaseUrl = typeof instance.baseUrl === 'string' ? instance.baseUrl : ''
    if (!instanceBaseUrl) {
      removedCount += 1
      continue
    }

    const processAlive = isProcessRunning(instancePid)
    const endpointResponsive = await isEndpointResponsive(`${instanceBaseUrl}/backend/login`, probeTimeoutMs)

    if (processAlive && endpointResponsive) {
      retainedInstances.push(instance)
      continue
    }

    removedCount += 1
  }

  if (removedCount > 0 || retainedInstances.length !== state.instances.length) {
    await writeDevInstancesState({ version: 1, instances: retainedInstances })
    console.log(`[dev:ephemeral] Removed ${removedCount} stale dev instance(s) from .ai/dev-ephemeral-envs.json.`)
  }
}

async function registerCurrentDevInstance(instance: DevEphemeralInstance): Promise<void> {
  const state = await readDevInstancesState()
  const nextInstances = state.instances.filter((candidate) => candidate && candidate.pid !== instance.pid)
  nextInstances.push(instance)
  await writeDevInstancesState({ version: 1, instances: nextInstances })
}

async function unregisterCurrentDevInstance(instancePid: number): Promise<void> {
  const state = await readDevInstancesState()
  const nextInstances = state.instances.filter((candidate) => candidate && candidate.pid !== instancePid)
  if (nextInstances.length !== state.instances.length) {
    await writeDevInstancesState({ version: 1, instances: nextInstances })
  }
}

function openUrlInBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let command = ''
    let args: string[] = []
    let useShell = false

    if (process.platform === 'darwin') {
      command = 'open'
      args = [url]
    } else if (process.platform === 'win32') {
      command = 'cmd'
      args = ['/c', 'start', '', url]
      useShell = true
    } else {
      command = 'xdg-open'
      args = [url]
    }

    const opener = spawn(command, args, {
      cwd: projectRootDirectory,
      stdio: 'ignore',
      shell: useShell,
      detached: true,
    })

    opener.on('error', () => resolve(false))
    opener.on('spawn', () => {
      opener.unref()
      resolve(true)
    })
  })
}

async function waitForDevServerReady(baseUrl: string): Promise<boolean> {
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    const responsive = await isEndpointResponsive(`${baseUrl}/backend/login`, probeTimeoutMs)
    if (responsive) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs))
  }

  return false
}

async function startDevServer(port: number): Promise<number> {
  const baseUrl = `http://127.0.0.1:${port}`
  const backendUrl = `${baseUrl}/backend`
  const devEnvironment = {
    ...process.env,
    PORT: String(port),
  }

  const devCommand = spawn('yarn', ['dev'], {
    cwd: projectRootDirectory,
    stdio: 'inherit',
    env: devEnvironment,
    shell: false,
  })

  if (!Number.isInteger(devCommand.pid) || devCommand.pid <= 0) {
    throw new Error('Failed to start development runtime process.')
  }

  const instanceState: DevEphemeralInstance = {
    id: `${devCommand.pid}:${new Date().toISOString()}`,
    pid: devCommand.pid,
    port,
    baseUrl,
    backendUrl,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
  }

  await registerCurrentDevInstance(instanceState)
  console.log(`[dev:ephemeral] Ephemeral URL: ${baseUrl}`)
  console.log(`[dev:ephemeral] Backend URL: ${backendUrl}`)

  const serverReady = await waitForDevServerReady(baseUrl)
  if (serverReady) {
    const browserOpened = await openUrlInBrowser(backendUrl)
    if (browserOpened) {
      console.log(`[dev:ephemeral] Opened browser at ${backendUrl}`)
    } else {
      console.log(`[dev:ephemeral] Browser auto-open failed. Open this URL manually: ${backendUrl}`)
    }
  } else {
    console.log(`[dev:ephemeral] Runtime did not become reachable within ${startupTimeoutMs / 1000}s. Continue watching logs above.`)
  }

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!devCommand.killed) {
      devCommand.kill(signal)
    }
  }

  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  return new Promise((resolve, reject) => {
    devCommand.on('error', async (error) => {
      await unregisterCurrentDevInstance(devCommand.pid as number)
      reject(error)
    })

    devCommand.on('exit', async (code, _signal) => {
      await unregisterCurrentDevInstance(devCommand.pid as number)
      resolve(code ?? 1)
    })
  })
}

async function main(): Promise<void> {
  try {
    assertNode24Runtime({
      context: 'dev ephemeral mode',
      retryCommand: 'yarn dev:ephemeral',
    })

    await mkdir(path.dirname(envPath), { recursive: true })
    await ensureEnvFile()

    console.log('[dev:ephemeral] Installing dependencies...')
    const installExitCode = await runCommand('yarn', ['install'])
    if (installExitCode !== 0) {
      process.exit(installExitCode)
      return
    }

    console.log('[dev:ephemeral] Preparing generated module files...')
    const generateExitCode = await runCommand('yarn', ['generate'])
    if (generateExitCode !== 0) {
      process.exit(generateExitCode)
      return
    }

    await pruneStaleDevInstances()

    const port = await resolvePort()
    console.log(`[dev:ephemeral] Starting development runtime on http://127.0.0.1:${port}/backend`)
    const exitCode = await startDevServer(port)
    process.exit(exitCode)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[dev:ephemeral] ${message}`)
    process.exit(1)
  }
}

await main()
