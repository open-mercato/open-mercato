import { access, readFile } from 'node:fs/promises'
import {
  businessAgentRuntimeCliPath,
  businessAgentRuntimeHostConfigPath,
} from '@open-mercato/business-harness/bin-path'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { agentOrchestratorTag } from '../../openapi'
import {
  businessHarnessRuntimeMode,
  resolveBusinessHarnessTransportMode,
} from '../../../lib/runtime/businessHarnessMode'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

export async function GET() {
  const transport = resolveBusinessHarnessTransportMode()
  const connector = await resolveConnectorHealthTarget()
  const [harnessHealth, capability] = await Promise.all([
    probeHarness(transport),
    connector.driver === 'mcp-http'
      ? probeJson(connector.healthUrl).then((health) => ({ driver: connector.driver, ...health }))
      : Promise.resolve({
          driver: connector.driver,
          healthy: connector.configured,
          detail: connector.configured ? 'configured' : 'invalid configuration',
        }),
  ])
  const harness = { ...harnessHealth, mode: businessHarnessRuntimeMode(transport) }
  return NextResponse.json(
    {
      status: harness.healthy && capability.healthy ? 'ok' : 'degraded',
      harness,
      capability,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

async function probeHarness(transport: 'stdio' | 'http'): Promise<{ healthy: boolean; detail: string }> {
  if (transport === 'http') {
    const harnessUrl = (process.env.OM_BUSINESS_HARNESS_URL?.trim() || 'http://127.0.0.1:4300').replace(
      /\/+$/,
      '',
    )
    const health = await probeJson(`${harnessUrl}/healthz`)
    return { healthy: health.healthy, detail: health.detail ?? 'http service' }
  }
  const cliPath = process.env.OM_BUSINESS_HARNESS_CLI_PATH?.trim() || businessAgentRuntimeCliPath
  try {
    await access(cliPath)
    return { healthy: true, detail: 'stdio one-off' }
  } catch {
    return { healthy: false, detail: 'runtime CLI is not built' }
  }
}

async function resolveConnectorHealthTarget(): Promise<
  | { driver: 'mcp-http'; healthUrl: string }
  | { driver: 'cli-stdio'; configured: boolean }
> {
  const fallbackHealthUrl =
    process.env.OM_MCP_HEALTH_URL?.trim() ||
    `http://127.0.0.1:${Number.parseInt(process.env.MCP_PORT ?? '', 10) || 3001}/health`
  const configFile =
    process.env.OM_BUSINESS_HARNESS_CONFIG_FILE?.trim() ||
    businessAgentRuntimeHostConfigPath
  try {
    const raw = JSON.parse(await readFile(configFile, 'utf8')) as {
      connectors?: Record<string, { driver?: unknown; command?: unknown }>
    }
    const connector = raw.connectors?.['open-mercato']
    if (connector?.driver === 'cli-stdio') {
      return { driver: 'cli-stdio', configured: typeof connector.command === 'string' && connector.command.length > 0 }
    }
  } catch {
    // The runtime will surface the detailed configuration error on execution.
  }
  return { driver: 'mcp-http', healthUrl: fallbackHealthUrl }
}

async function probeJson(url: string): Promise<{ healthy: boolean; detail?: string; tools?: number }> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return {
      healthy: response.ok,
      ...(typeof body?.service === 'string'
        ? { detail: body.service }
        : typeof body?.status === 'string'
          ? { detail: body.status }
          : {}),
      ...(typeof body?.tools === 'number' ? { tools: body.tools } : {}),
    }
  } catch {
    return { healthy: false }
  }
}

export const openApi = {
  tags: [agentOrchestratorTag],
  summary: 'Check business harness and capability transport health',
  methods: {
    GET: {
      summary: 'Check business harness and MCP health',
      tags: [agentOrchestratorTag],
      responses: [
        {
          status: 200,
          description: 'Current runtime dependency health',
          schema: z.object({
            status: z.enum(['ok', 'degraded']),
            harness: z.object({
              healthy: z.boolean(),
              detail: z.string().optional(),
              mode: z.enum(['one-off', 'standalone']),
            }),
            capability: z.object({
              driver: z.enum(['mcp-http', 'cli-stdio']),
              healthy: z.boolean(),
              detail: z.string().optional(),
              tools: z.number().optional(),
            }),
          }),
        },
      ],
    },
  },
}
