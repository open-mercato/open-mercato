export const features = [
  { id: 'configs.system_status.view', title: 'View system status', module: 'configs' },
  { id: 'configs.cache.view', title: 'View cache overview', module: 'configs' },
  { id: 'configs.cache.manage', title: 'Manage cache', module: 'configs' },
  { id: 'configs.manage', title: 'Manage configuration', module: 'configs' },
  // Queue Status Dashboard (#3105). Tier 1 is payload-free and safe to grant broadly.
  { id: 'configs.queues_status.view', title: 'View queue status', module: 'configs' },
  // Tier 2 — privileged, reads raw job payloads. Deliberately NOT bundled with
  // `.view`: granted to platform-operator/superadmin roles only (see setup.ts).
  { id: 'configs.queues_status.inspect_payloads', title: 'Inspect queue job payloads', module: 'configs' },
]

export default features
