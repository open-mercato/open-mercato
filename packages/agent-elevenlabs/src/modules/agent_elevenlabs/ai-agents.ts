/**
 * Where the AGENT registers — separately from the connector, which registers in
 * `di.ts`.
 *
 * The two are independent on purpose: this file's side effect only runs behind
 * `ensureAgentsLoaded()`, while the unauthenticated callback route needs the
 * connector without ever loading the agent registry.
 *
 * `voice.owner_call` is a demo-grade but REAL agent: its OUTCOME schema is the
 * one `normalize()` actually produces, which is what makes
 * `outputMapping: { call: 'data.collected.owner_decision' }` typecheck in the
 * Studio's variable picker rather than resolve to `unknown`.
 *
 * Everything about HOW the call goes lives at ElevenLabs — the voice, the
 * script, the data-collection schema — so `instructions` here is operator-facing
 * documentation, not a prompt. What this side of the boundary owns is the
 * CONTRACT: which dynamic variables the prompt may reference, and which fields
 * the workflow will get back.
 */

import { defineExternalAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineExternalAgent'
import { voiceCallResultSchema } from './data/validators'
import { ELEVENLABS_VOICE_CONNECTOR_ID } from './lib/connector'
import { DEFAULT_PROFILE_NAME } from './lib/credentials'

export const OWNER_CALL_AGENT_ID = 'voice.owner_call'

/**
 * The profile this agent dials with, and the reason it is `default`.
 *
 * A named profile (`'owner_call'`) would be the more expressive choice and it is
 * the WRONG one for the agent that ships with the package: naming it would make
 * every tenant that already configured the integration — and every tenant that
 * configures it tomorrow by filling in Agent ID and Phone Number ID — fail
 * closed on their first call, because `owner_call` is not a profile they have.
 * The shipped agent therefore names the profile every tenant necessarily has,
 * and the naming is demonstrated in the instructions for the agents a tenant
 * writes itself.
 */
export const OWNER_CALL_PROFILE = DEFAULT_PROFILE_NAME

defineExternalAgent({
  id: OWNER_CALL_AGENT_ID,
  moduleId: 'agent_elevenlabs',
  label: 'Call a person and collect an answer',
  description:
    'Places an outbound ElevenLabs voice call, states the brief, and comes back with what the conversation collected.',
  connectorId: ELEVENLABS_VOICE_CONNECTOR_ID,
  profile: OWNER_CALL_PROFILE,
  agentType: 'researcher',
  // RESEARCHER, and structurally unable to be anything else: `defineExternalAgent`
  // rejects a proposal-kind external agent, because a third party's self-reported
  // confidence must never clear `autoApproveThreshold` on a domain write. This
  // agent reports what a human said; the NEXT (native) agent proposes.
  result: { kind: 'researcher', schema: voiceCallResultSchema },
  // Deadline is mandatory: without one, a call nobody answers parks the workflow
  // forever (design R2). 30 minutes covers a call placed, missed, retried by the
  // provider and analysed; the sweep fails the run and wakes the step down the
  // `error` handle if nothing has arrived by then.
  timeout: '30m',
  instructions: [
    'Runs at ElevenLabs, not in this process. Configure the tenant credentials under',
    'Integrations -> ElevenLabs Conversational AI, and write the call script in the',
    'ElevenLabs agent prompt.',
    '',
    'This agent dials with the "default" call profile — the Agent ID and Phone Number ID',
    'fields of that integration. To run a second voice agent (a satisfaction survey, a',
    'payment chase) from the same ElevenLabs account, add a named profile under',
    'Call Profiles and register an agent with defineExternalAgent({ profile: "<name>" }).',
    'An agent naming a profile the tenant has not configured fails before the call is',
    'placed, so nobody is ever rung by the wrong script.',
    '',
    'The prompt may reference {{brief}} (the node input\'s `brief`) and any key the node',
    'passes in `variables`. It must NOT reference {{om_callback_url}} — that is a reserved',
    'bearer credential and an agent that reads it could speak it aloud.',
    '',
    'Whatever the ElevenLabs agent is configured to collect comes back under',
    '`data.collected.<key>`; its evaluation criteria come back under `data.criteria.<key>`.',
  ].join(' '),
  sampleInput: {
    toNumber: '+48123456789',
    brief:
      'The ACME renewal deal has gone quiet 4 days before close. Ask whether they still intend to renew this quarter, and if not, what changed.',
    variables: {
      company_name: 'ACME',
      deal_value: 48000,
      owner_first_name: 'Anna',
    },
  },
})
