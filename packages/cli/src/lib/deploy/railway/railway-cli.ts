import { spawnSync } from 'node:child_process'
import { redactText } from './redaction'

function runRailway(args: string[], cwd: string, token: string, secrets: string[]): string {
  const result = spawnSync('railway', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, RAILWAY_API_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  if (result.status !== 0) {
    throw new Error(redactText(output || `railway ${args[0] ?? ''} failed`, secrets))
  }
  return output
}

export function uploadLocalSource(input: {
  cwd: string
  projectId: string
  environmentId: string
  serviceId: string
  serviceName: string
  token: string
}): string | null {
  runRailway(
    [
      'link',
      '--project',
      input.projectId,
      '--environment',
      input.environmentId,
      '--service',
      input.serviceId,
    ],
    input.cwd,
    input.token,
    [input.token],
  )
  const output = runRailway(
    [
      'up',
      '--environment',
      input.environmentId,
      '--service',
      input.serviceName,
      '--detach',
      '--json',
    ],
    input.cwd,
    input.token,
    [input.token],
  )
  try {
    const parsed: unknown = JSON.parse(output)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const deploymentId = record.deploymentId ?? record.deployment_id ?? record.id
      return typeof deploymentId === 'string' ? deploymentId : null
    }
  } catch {
    return null
  }
  return null
}
