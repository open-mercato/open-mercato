/**
 * Configuration-side permissions only.
 *
 * The permission that gates actually STARTING an external run is not here: it is
 * `agent_orchestrator.external_agents.invoke`, declared by the orchestrator and
 * deliberately granted to no persona by default (T2.8). Declaring a second,
 * provider-owned invoke feature would give a tenant two places to look and one of
 * them would eventually be the wrong one.
 */
export const features = [
  {
    id: 'agent_http.view',
    title: 'View HTTP agent integration configuration',
    module: 'agent_http',
    dependsOn: ['integrations.view'],
  },
  {
    id: 'agent_http.configure',
    title: 'Configure HTTP agent integration credentials',
    module: 'agent_http',
    dependsOn: ['agent_http.view', 'integrations.credentials.manage'],
  },
]

export default features
