export const enterprisePackage = {
  id: 'enterprise',
  description: 'Optional enterprise overlays and modules for Open Mercato.',
  modules: ['security', 'sso', 'record_locks', 'agent_orchestrator', 'system_status_overlays', 'backups', 'data_erasure'],
} as const

export default enterprisePackage
