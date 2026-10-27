export const enterprisePackage = {
  id: 'enterprise',
  description: 'Optional enterprise overlays and modules for Open Mercato.',
  modules: ['security', 'sso', 'record_locks', 'agent_orchestrator'],
} as const

export default enterprisePackage
