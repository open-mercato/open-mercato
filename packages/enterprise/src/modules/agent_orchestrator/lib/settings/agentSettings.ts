import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentSetting } from '../../data/entities'
import { DEFAULT_AGENT_ICONS, isAgentIconName, type AgentIconName } from '../../data/agentIcons'

export type AgentSettingsScope = { tenantId: string; organizationId: string }

/**
 * Load the per-(tenant, organization) agent icon overrides as a plain map of
 * `agentId → iconName`. Only rows with a recognised icon name are returned;
 * unknown / stale names are dropped so the caller can safely fall back. The
 * agents list/overview merge this over the code-authored registry.
 */
export async function getAgentIconMap(
  em: EntityManager,
  scope: AgentSettingsScope,
): Promise<Map<string, AgentIconName>> {
  const rows = await em.find(AgentSetting, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const map = new Map<string, AgentIconName>()
  for (const row of rows) {
    if (isAgentIconName(row.icon)) map.set(row.agentId, row.icon)
  }
  return map
}

/**
 * Load the single settings row for one agent, or null when the tenant has not
 * customised it. Used by the agent detail route to return the current icon plus
 * its `updatedAt` (the optimistic-lock version the picker echoes back on write).
 */
export async function getAgentSettingRow(
  em: EntityManager,
  scope: AgentSettingsScope,
  agentId: string,
): Promise<AgentSetting | null> {
  return em.findOne(AgentSetting, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    agentId,
  })
}

/**
 * Idempotently seed the default agent icons for a tenant/org. Only inserts rows
 * for agent ids that have no row yet — it never overwrites an existing row, so a
 * user's later edit survives re-running tenant setup. Safe to call on every
 * `seedDefaults`.
 */
export async function seedDefaultAgentIcons(
  em: EntityManager,
  scope: AgentSettingsScope,
): Promise<void> {
  const existing = await em.find(AgentSetting, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const seeded = new Set(existing.map((row) => row.agentId))
  let created = false
  for (const [agentId, icon] of Object.entries(DEFAULT_AGENT_ICONS)) {
    if (seeded.has(agentId)) continue
    em.persist(
      em.create(AgentSetting, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentId,
        icon,
      }),
    )
    created = true
  }
  if (created) await em.flush()
}
