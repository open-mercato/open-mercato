export const integrationMeta = {
  description:
    'Deal-briefing call: a workflow parks on an out-of-band voice step, a signed callback resumes it, the idempotent ensure-task command writes CRM tasks, and the run announces itself as an in-app notification. Driven with the agent_probe connector, which performs no network I/O — nothing in this folder may place a phone call.',
  dependsOnModules: ['sales_call_planner', 'agent_orchestrator', 'workflows', 'customers', 'notifications', 'agent_probe'],
}
