import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRootDirectory = path.resolve(scriptDirectory, '..')
const appDirectory = path.join(projectRootDirectory, 'apps', 'mercato')
const envExamplePath = path.join(appDirectory, '.env.example')
const envPath = path.join(appDirectory, '.env')
const devInstancesFilePath = path.join(projectRootDirectory, '.ai', 'dev-ephemeral-envs.json')
const preferredPort = Number.parseInt(process.env.DEV_EPHEMERAL_PREFERRED_PORT ?? '3000', 10)
const startupTimeoutMs = 120000
const readinessProbeIntervalMs = 1000
const probeTimeoutMs = 1500

function assertNode24Runtime() {
  const majorVersion = Number.parseInt((process.versions.node || '0').split('.')[0] || '0', 10)
  if (majorVersion >= 24) {
    return
  }

  throw new Error(
    [
      'Unsupported Node.js runtime for dev ephemeral mode.',
      `Cause: Detected Node ${process.versions.node}, but this repository requires Node 24.x.`,
      'What to do: switch your shell to Node 24 (for example `nvm use 24`), reinstall dependencies (`yarn install`), then retry `yarn dev:ephemeral`.',
    ].join(' '),
  )
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function ensureEnvFile() {
  if (await fileExists(envPath)) {
    console.log('[dev:ephemeral] Reusing existing apps/mercato/.env file.')
    return
  }

  await copyFile(envExamplePath, envPath)
  console.log('[dev:ephemeral] Created apps/mercato/.env from apps/mercato/.env.example.')
}

function runCommand(command, args, options = {}) {
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

async function isPortAvailable(port) {
  const canBind = (host) => new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error) => {
      const errorCode = error && typeof error === 'object' ? error.code : null
      if (errorCode === 'EAFNOSUPPORT') {
        resolve(null)
        return
      }
      resolve(false)
    })
    server.listen(port, host, () => {
      server.close(() => {
        resolve(true)
      })
    })
  })

  const ipv4Availability = await canBind('127.0.0.1')
  if (ipv4Availability === false) {
    return false
  }

  const ipv6Availability = await canBind('::1')
  if (ipv6Availability === false) {
    return false
  }

  return ipv4Availability === true || ipv6Availability === true
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate free port.'))
        return
      }

      const allocatedPort = address.port
      server.close((closeError) => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolve(allocatedPort)
      })
    })
  })
}

async function resolvePort() {
  if (Number.isFinite(preferredPort) && preferredPort > 0 && preferredPort <= 65535 && await isPortAvailable(preferredPort)) {
    return preferredPort
  }

  const fallbackPort = await getFreePort()
  console.log(`[dev:ephemeral] Preferred port ${preferredPort} is not available. Using ${fallbackPort}.`)
  return fallbackPort
}

async function readDevInstancesState() {
  let rawState = ''
  try {
    rawState = await readFile(devInstancesFilePath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { version: 1, instances: [] }
    }
    throw error
  }

  try {
    const parsedState = JSON.parse(rawState)
    if (!parsedState || typeof parsedState !== 'object' || !Array.isArray(parsedState.instances)) {
      return { version: 1, instances: [] }
    }
    return {
      version: 1,
      instances: parsedState.instances,
    }
  } catch {
    return { version: 1, instances: [] }
  }
}

async function writeDevInstancesState(state) {
  await mkdir(path.dirname(devInstancesFilePath), { recursive: true })
  await writeFile(devInstancesFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EPERM') {
      return true
    }
    return false
  }
}

async function isEndpointResponsive(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(probeTimeoutMs),
    })
    return response.status > 0
  } catch {
    return false
  }
}

async function pruneStaleDevInstances() {
  const state = await readDevInstancesState()
  const retainedInstances = []
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
    const endpointResponsive = await isEndpointResponsive(`${instanceBaseUrl}/backend/login`)

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

async function registerCurrentDevInstance(instance) {
  const state = await readDevInstancesState()
  const nextInstances = state.instances.filter((candidate) => candidate && candidate.pid !== instance.pid)
  nextInstances.push(instance)
  await writeDevInstancesState({ version: 1, instances: nextInstances })
}

async function unregisterCurrentDevInstance(instancePid) {
  const state = await readDevInstancesState()
  const nextInstances = state.instances.filter((candidate) => candidate && candidate.pid !== instancePid)
  if (nextInstances.length !== state.instances.length) {
    await writeDevInstancesState({ version: 1, instances: nextInstances })
  }
}

function openUrlInBrowser(url) {
  return new Promise((resolve) => {
    let command = ''
    let args = []
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

async function waitForDevServerReady(baseUrl) {
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    const responsive = await isEndpointResponsive(`${baseUrl}/backend/login`)
    if (responsive) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs))
  }

  return false
}

async function startDevServer(port) {
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

  const instanceState = {
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

  const forwardSignal = (signal) => {
    if (!devCommand.killed) {
      devCommand.kill(signal)
    }
  }

  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  return new Promise((resolve, reject) => {
    devCommand.on('error', async (error) => {
      await unregisterCurrentDevInstance(devCommand.pid)
      reject(error)
    })

    devCommand.on('exit', async (code, signal) => {
      await unregisterCurrentDevInstance(devCommand.pid)

      if (signal) {
        resolve(128)
        return
      }

      resolve(code ?? 1)
    })
  })
}

async function main() {
  try {
    assertNode24Runtime()
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
