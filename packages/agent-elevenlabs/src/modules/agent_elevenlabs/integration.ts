/**
 * The ElevenLabs entry in the integrations marketplace: what an operator
 * configures, per tenant, before any workflow can place a call.
 *
 * The two `secret`-typed fields are the ones that matter. Everything in the
 * credential record is encrypted at rest by the credential store regardless of
 * type; `secret` is what keeps the value masked in the admin UI and redacted out
 * of the read-back API. The API key and the webhook secret are the only two
 * values here that would let someone else place calls on this tenant's account
 * or forge a settlement, so they are the only two typed `secret`.
 */

import type {
  IntegrationBundle,
  IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'

export const ELEVENLABS_INTEGRATION_ID = 'agent_elevenlabs'

export const integration: IntegrationDefinition = {
  id: ELEVENLABS_INTEGRATION_ID,
  title: 'ElevenLabs Conversational AI',
  description:
    'Place outbound voice calls from a workflow with an ElevenLabs conversational agent, and resume the workflow with what the call collected.',
  category: 'communication',
  providerKey: 'elevenlabs',
  docsUrl: 'https://elevenlabs.io/docs/conversational-ai/overview',
  package: '@open-mercato/agent-elevenlabs',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['voice', 'outbound-call', 'agents', 'conversational-ai'],
  credentials: {
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'secret',
        required: true,
        placeholder: 'sk_...',
        helpText:
          'ElevenLabs dashboard -> Developers -> API Keys. Needs Conversational AI access; it is used for every outbound call placed by this tenant.',
      },
      {
        key: 'webhookSecret',
        label: 'Post-call Webhook Secret',
        type: 'secret',
        required: true,
        placeholder: 'wsec_...',
        helpText:
          'ElevenLabs dashboard -> Settings -> Webhooks, the signing secret of the post-call webhook. Every callback is HMAC-verified against it before a workflow is resumed; a call whose signature does not verify is discarded. Point that webhook at this deployment, or no call will ever resume its workflow.',
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        type: 'text',
        required: true,
        helpText:
          'The ElevenLabs conversational agent that places the call. Its prompt is where the call script lives; it can reference {{brief}} and any variable the workflow node passes.',
      },
      {
        key: 'agentPhoneNumberId',
        label: 'Phone Number ID',
        type: 'text',
        required: true,
        helpText:
          'ElevenLabs dashboard -> Conversational AI -> Phone Numbers. This is the ElevenLabs id of the number, not the number itself.',
      },
      {
        key: 'telephonyProvider',
        label: 'Telephony Provider',
        type: 'select',
        required: false,
        options: [
          { value: 'twilio', label: 'Twilio' },
          { value: 'sip_trunk', label: 'SIP trunk' },
        ],
        helpText:
          'How the phone number above is wired at ElevenLabs. It selects which outbound-call endpoint is used; leave it on Twilio unless the number is on a SIP trunk.',
      },
      {
        key: 'defaultCallerId',
        label: 'Default Caller ID',
        type: 'text',
        required: false,
        placeholder: '+48123456789',
        helpText:
          'Optional number presented to the person being called. Set per tenant, never per workflow — who is calling is a compliance decision.',
      },
      {
        key: 'callRecordingEnabled',
        label: 'Record Calls',
        type: 'boolean',
        required: false,
        helpText:
          'Leave unset to use whatever the ElevenLabs agent is configured to do. Recording a call is regulated in most jurisdictions; enabling it here does not by itself satisfy a notice or consent obligation.',
      },
    ],
  },
  healthCheck: { service: 'elevenLabsVoiceHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
