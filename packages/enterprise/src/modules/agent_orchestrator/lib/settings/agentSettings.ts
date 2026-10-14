import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentSetting } from '../../data/entities'
import { DEFAULT_AGENT_ICONS, isAgentIconName, type AgentIconName } from '../../data/agentIcons'
import { normalizeAgentTags } from '../../data/agentTags'

export type AgentSettingsScope = { tenantId: string; organizationId: string }

export type AgentPresentationMaps = {
  /** Only recognised icon names; unknown / stale ones are dropped so callers can fall back. */
  icons: Map<string, AgentIconName>
  /** Only agents with at least one tag, so a miss means "untagged". */
  tags: Map<string, string[]>
}

/**
 * Load every per-(tenant, organization) presentation override in one read. The
 * agents list merges both maps over the code-authored registry, so splitting
 * them into two queries would scan the same rows twice.
 */
export async function getAgentPresentationMaps(
  em: EntityManager,
  scope: AgentSettingsScope,
): Promise<AgentPresentationMaps> {
  const rows = await em.find(AgentSetting, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const icons = new Map<string, AgentIconName>()
  const tags = new Map<string, string[]>()
  for (const row of rows) {
    if (isAgentIconName(row.icon)) icons.set(row.agentId, row.icon)
    const rowTags = normalizeAgentTags(row.tags)
    if (rowTags.length) tags.set(row.agentId, rowTags)
  }
  return { icons, tags }
}

/** `agentId → iconName` for the tenant. Kept as a stable import path for callers that only need icons. */
export async function getAgentIconMap(
  em: EntityManager,
  scope: AgentSettingsScope,
): Promise<Map<string, AgentIconName>> {
  return (await getAgentPresentationMaps(em, scope)).icons
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
