export const integrationMeta = {
  description:
    'External-agent seam (suspend → verified callback → resume) driven through a test connector that performs no network I/O.',
  dependsOnModules: ['agent_orchestrator', 'workflows', 'agent_probe'],
}
