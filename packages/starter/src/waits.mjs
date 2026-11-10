import { parseComposePsOutput, runCompose } from './compose.mjs'
import { createSpinner } from './ui.mjs'

// Health-wait loops for the fully containerized mode, ported from the retired
// Windows launcher (start-dev.ps1) so every platform gets the same sequencing:
//   infra healthy -> app serving -> mcp + opencode healthy -> e2e MCP wiring.
// Crash-loop detection beats compose healthchecks here: the generous
// start_periods keep a wedged service "starting" for minutes, while a service
// stuck in restarting/exited flips visibly within three polls.

const POLL_INTERVAL_MS = 5000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function serviceStates(repoRoot, composeFile) {
  const ps = runCompose(repoRoot, ['ps', '-a', '--format', 'json'], { composeFile, stdio: 'pipe' })
  const states = {}
  for (const entry of parseComposePsOutput(ps.stdout ?? '')) {
    if (!entry?.Service) continue
    states[entry.Service] = { state: entry.State ?? 'unknown', health: entry.Health ?? '', exitCode: entry.ExitCode }
  }
  return states
}

function dumpServiceLogs(repoRoot, composeFile, service, log) {
  log(`── last 40 log lines of '${service}' ──`)
  runCompose(repoRoot, ['logs', '--tail', '40', service], { composeFile, stdio: 'inherit' })
}

export async function waitForHealthyServices(repoRoot, composeFile, services, { timeoutMs = 5 * 60 * 1000, log = console.log } = {}) {
  const crashTicks = {}
  const deadline = Date.now() + timeoutMs
  const spinner = createSpinner(`waiting for ${services.join(', ')}`)
  try {
    while (Date.now() < deadline) {
      const states = serviceStates(repoRoot, composeFile)
      const pending = []
      for (const service of services) {
        const entry = states[service]
        if (!entry) {
          pending.push(`${service} (not created)`)
          continue
        }
        const crashed = entry.state === 'restarting' || (entry.state === 'exited' && Number(entry.exitCode ?? 0) !== 0)
        crashTicks[service] = crashed ? (crashTicks[service] ?? 0) + 1 : 0
        if (crashTicks[service] >= 3) {
          spinner.stop('fail', `Service '${service}' is crash-looping (${entry.state}).`)
          dumpServiceLogs(repoRoot, composeFile, service, log)
          return { ok: false, failed: service }
        }
        const healthy = entry.health ? entry.health === 'healthy' : entry.state === 'running'
        if (!healthy) pending.push(`${service} (${entry.health || entry.state})`)
      }
      if (pending.length === 0) {
        spinner.stop('ok', `${services.join(', ')} healthy`)
        return { ok: true }
      }
      spinner.update(`waiting for ${pending.join(', ')}`)
      await sleep(POLL_INTERVAL_MS)
    }
  } finally {
    spinner.stop()
  }
  return { ok: false, failed: 'timeout' }
}

export async function waitForHttp(url, { timeoutMs = 10 * 60 * 1000, label = url, log = console.log, validate = null } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  const spinner = createSpinner(`waiting for ${label}`)
  try {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (response.ok) {
          if (!validate) {
            spinner.stop('ok', `${label} ready`)
            return true
          }
          const body = await response.text()
          if (validate(body)) {
            spinner.stop('ok', `${label} ready`)
            return true
          }
          lastError = 'endpoint up, validation pending'
        } else {
          lastError = `HTTP ${response.status}`
        }
      } catch (error) {
        lastError = error?.cause?.code ?? error?.name ?? 'unreachable'
      }
      spinner.update(`waiting for ${label} (${lastError})`)
      await sleep(POLL_INTERVAL_MS)
    }
  } finally {
    spinner.stop()
  }
  log(`Timed out waiting for ${label} (${lastError})`)
  return false
}
