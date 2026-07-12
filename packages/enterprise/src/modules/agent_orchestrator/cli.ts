import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProposal, AgentRun } from './data/entities'
import { recomputeAgentProcess } from './lib/processes/agentProcessProjection'

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^-+/, '')
    const value = args[i + 1]
    if (key && value) result[key] = value
  }
  return result
}

/**
 * Rebuilds the `agent_processes` read-model from the module's own proposals +
 * runs (process projection spec, 2026-06-25): every distinct
 * `(tenant, org, processId)` with agent activity is recomputed through the same
 * idempotent upsert the event subscribers use, so re-running is a no-op. Used
 * for first rollout and drift repair. Terminal statuses latched from prior
 * `workflows.instance.*` events are preserved on existing rows; rows created
 * fresh here re-derive from agent data alone (tier A) until the next lifecycle
 * event arrives.
 *
 *   yarn mercato agent_orchestrator rebuild-processes [--tenant <tenantId>]
 */
const rebuildProcesses: ModuleCli = {
  command: 'rebuild-processes',
  async run(rest: string[]) {
    const args = parseArgs(rest ?? [])
    const { resolve } = await createRequestContainer()
    const em = (resolve('em') as EntityManager).fork()

    const tenantFilter = args.tenant ? { tenantId: args.tenant } : {}
    const [proposalKeys, runKeys] = await Promise.all([
      em.find(
        AgentProposal,
        { ...tenantFilter, processId: { $ne: null }, deletedAt: null },
        { fields: ['id', 'tenantId', 'organizationId', 'processId'] },
      ),
      em.find(
        AgentRun,
        { ...tenantFilter, processId: { $ne: null }, deletedAt: null },
        { fields: ['id', 'tenantId', 'organizationId', 'processId'] },
      ),
    ])

    const seen = new Map<string, { tenantId: string; organizationId: string; processId: string }>()
    for (const row of [...proposalKeys, ...runKeys]) {
      if (!row.processId) continue
      const key = `${row.tenantId}:${row.organizationId}:${row.processId}`
      if (!seen.has(key)) {
        seen.set(key, {
          tenantId: row.tenantId,
          organizationId: row.organizationId,
          processId: row.processId,
        })
      }
    }

    console.log(`Rebuilding ${seen.size} agent process projection row(s)…`)
    let rebuilt = 0
    for (const scope of seen.values()) {
      const result = await recomputeAgentProcess(
        em.fork(),
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
        scope.processId,
      )
      if (result) rebuilt += 1
    }
    console.log(`Done. ${rebuilt}/${seen.size} row(s) upserted.`)
  },
}

const agentOrchestratorCliCommands = [rebuildProcesses]

export default agentOrchestratorCliCommands
