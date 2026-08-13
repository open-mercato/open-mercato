/**
 * Two test-only external agents, differing only in their callback deadline.
 *
 * `probe.echo` is the ordinary case: half an hour to answer, which is longer than
 * any test runs, so the deadline never interferes. `probe.echo_expiring` gives the
 * provider one second, which is what makes the deadline sweep — "a call nobody
 * answers must never park a workflow forever" — executable rather than argued.
 */

import { z } from 'zod'
import { defineExternalAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineExternalAgent'
import { PROBE_CONNECTOR_ID } from './lib/probeConnector'

export const PROBE_AGENT_ID = 'probe.echo'
export const PROBE_EXPIRING_AGENT_ID = 'probe.echo_expiring'

/** The ENVELOPE, not the inner shape — see `defineExternalAgent`. */
const probeResultSchema = z.object({
  kind: z.literal('researcher'),
  data: z.object({ answer: z.string() }),
})

const sharedInstructions =
  'Test-only agent. Its connector performs no network I/O: it mints a run id, records the per-run callback URL, and waits for the integration suite to play the provider.'

defineExternalAgent({
  id: PROBE_AGENT_ID,
  moduleId: 'agent_probe',
  label: 'Probe echo agent (test only)',
  description: 'Parks the step and resumes it with whatever answer the signed callback carries.',
  connectorId: PROBE_CONNECTOR_ID,
  agentType: 'researcher',
  result: { kind: 'researcher', schema: probeResultSchema },
  timeout: '30m',
  instructions: sharedInstructions,
  sampleInput: { brief: 'Ask the probe to echo something back.' },
})

defineExternalAgent({
  id: PROBE_EXPIRING_AGENT_ID,
  moduleId: 'agent_probe',
  label: 'Probe echo agent with a one-second deadline (test only)',
  description: 'Same as the probe echo agent, but its callback deadline expires almost immediately.',
  connectorId: PROBE_CONNECTOR_ID,
  agentType: 'researcher',
  result: { kind: 'researcher', schema: probeResultSchema },
  timeout: '1s',
  instructions: sharedInstructions,
  sampleInput: { brief: 'Nobody will answer this one.' },
})
