// Docker is OPTIONAL for every dev flow in `scripts/dev.mjs`. It is consulted
// only to bounce the containerized OpenCode agent after the MCP key rotates, so
// a machine without Docker — or with a stopped or wedged daemon — must degrade
// to "there is no container to restart" instead of failing or stalling the run.
//
// `spawnSync` blocks the whole event loop, so the probe MUST stay bounded: an
// unresponsive daemon once froze the splash server and the runtime collector for
// as long as the CLI hung, leaving the dev splash stuck on "preparing" while the
// app itself was already serving.

export const DOCKER_PROBE_TIMEOUT_MS = 10_000

/**
 * Classify the result of `docker ps --format '{{.Names}}'`.
 *
 * Returns the running container names when Docker answered, or the reason it
 * could not — never throws, so callers can treat every failure as "skip".
 */
export function classifyDockerProbe(result) {
  if (!result || result.error) {
    const code = result?.error?.code
    if (code === 'ENOENT') {
      return { available: false, reason: 'cli-missing', detail: 'the docker CLI is not installed' }
    }
    if (code === 'ETIMEDOUT') {
      return { available: false, reason: 'unresponsive', detail: 'the daemon did not respond in time' }
    }
    return {
      available: false,
      reason: 'probe-failed',
      detail: code ?? result?.error?.message ?? 'the probe failed',
    }
  }

  if (result.status !== 0) {
    return { available: false, reason: 'daemon-unreachable', detail: 'the daemon is not reachable' }
  }

  return { available: true, reason: 'ok', names: parseContainerNames(result.stdout) }
}

function parseContainerNames(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
