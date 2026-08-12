/**
 * Configuration-side permissions only.
 *
 * The permission that gates actually PLACING a call is not here: it is
 * `agent_orchestrator.external_agents.invoke`, declared by the orchestrator and
 * deliberately granted to no persona by default (T2.8). Declaring a second,
 * provider-owned invoke feature would give a tenant two places to look and one
 * of them would eventually be the wrong one.
 */
export const features = [
  {
    id: 'agent_elevenlabs.view',
    title: 'View ElevenLabs voice integration configuration',
    module: 'agent_elevenlabs',
    dependsOn: ['integrations.view'],
  },
  {
    id: 'agent_elevenlabs.configure',
    title: 'Configure ElevenLabs voice integration credentials',
    module: 'agent_elevenlabs',
    dependsOn: ['agent_elevenlabs.view', 'integrations.credentials.manage'],
  },
]

export default features
