/**
 * Canonical vocabulary of per-agent presentation icons.
 *
 * These are stable string names (kebab-case) persisted in `agent_settings.icon`
 * and validated on write. They are deliberately NOT lucide component references
 * here so this module stays server-safe (importable by the validator, the API
 * route, and `setup.ts` seeding) — the string → lucide component mapping lives
 * in the client-only `components/agentChips.tsx` (`AGENT_ICON`).
 *
 * Keep this list and the client `AGENT_ICON` map in sync: every name here MUST
 * have a component entry, and the `agentChips.test` guard enforces it.
 */
export const AGENT_ICON_NAMES = [
  'stethoscope',
  'heart-pulse',
  'filter',
  'layers',
  'radar',
  'compass',
  'globe',
  'search',
  'list-checks',
  'headset',
  'bot',
  'sparkles',
  'shield-check',
  'workflow',
] as const

export type AgentIconName = (typeof AGENT_ICON_NAMES)[number]

const ICON_NAME_SET: ReadonlySet<string> = new Set(AGENT_ICON_NAMES)

export function isAgentIconName(value: unknown): value is AgentIconName {
  return typeof value === 'string' && ICON_NAME_SET.has(value)
}

/**
 * Default icon per known agent definition id, seeded per tenant in `setup.ts`.
 * Unknown / future agents are not seeded — the UI falls back to a type glyph
 * (actionable/informative) and finally to initials, so this map is additive and
 * safe to leave incomplete.
 */
export const DEFAULT_AGENT_ICONS: Readonly<Record<string, AgentIconName>> = {
  'deals.health_check': 'stethoscope',
  'deals.health_check_file': 'heart-pulse',
  'deals.activity_scan': 'radar',
  'deals.web_researcher': 'globe',
  'support.ticket_triage': 'filter',
  'support.triage_batch': 'layers',
  'support.resolution_advisor': 'compass',
}
