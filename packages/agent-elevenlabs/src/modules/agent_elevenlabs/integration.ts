/**
 * The ElevenLabs entry in the integrations marketplace: what an operator
 * configures, per tenant, before any workflow can place a call.
 *
 * WHY "Call Profiles" IS A JSON STRING IN A `text` FIELD and not a repeating
 * group: `CredentialFieldType` has no list/group/json member and the admin write
 * path (`saveCredentialsSchema`) types every credential VALUE as
 * `string | number | boolean | null`, so a nested value is a 422 no matter what
 * this file declares. The storage column is jsonb and would hold it happily; the
 * FORM is the constraint. See `lib/credentials.ts`'s header for the full
 * reasoning and the alternative that was rejected.
 *
 * The two `secret`-typed fields are the ones that matter. Everything in the
 * credential record is encrypted at rest by the credential store regardless of
 * type; `secret` is what keeps the value masked in the admin UI and redacted out
 * of the read-back API. The API key and the webhook secret are the only two
 * values here that would let someone else place calls on this tenant's account
 * or forge a settlement, so they are the only two typed `secret`.
 *
 * THE ONE MANUAL STEP THIS INTEGRATION CANNOT DO FOR THE OPERATOR is pointing
 * ElevenLabs at us. ElevenLabs' post-call webhook destination is a workspace (or
 * agent) setting, not a per-call parameter, so the operator pastes ONE static
 * URL there — `<deployment origin>` + `ELEVENLABS_CALLBACK_PATH` — and every
 * conversation's answer arrives at it. Without that step a call is placed, the
 * person answers, and the workflow stays parked until the deadline sweep fails
 * it, so it is stated in the webhook-secret help text where an operator is
 * already looking. The path constant is asserted against the help text in
 * `__tests__/normalize.test.ts`, so the two cannot drift.
 */

import type {
  IntegrationBundle,
  IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'
import { PROFILES_CREDENTIAL_KEY } from './lib/credentials'

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
          'ElevenLabs dashboard -> Settings -> Webhooks, the signing secret of the post-call webhook. REQUIRED SETUP: point that webhook at https://<your-deployment>/api/agent_orchestrator/external-runs/connectors/elevenlabs.voice/callback — one static URL, pasted once, shared by every call. Until you do, calls are placed but no workflow ever resumes. This secret is the ONLY credential that callback carries: every payload is HMAC-verified against it, it is what proves the answer belongs to this tenant, and anything that fails to verify is discarded.',
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        type: 'text',
        required: false,
        helpText:
          'The ElevenLabs conversational agent used by the DEFAULT call profile — every agent that does not name a profile of its own dials with this one. Its prompt is where the call script lives; it can reference {{brief}} and any variable the workflow node passes. Leave blank only if you define a "default" entry under Call Profiles instead.',
      },
      {
        key: 'agentPhoneNumberId',
        label: 'Phone Number ID',
        type: 'text',
        required: false,
        helpText:
          'ElevenLabs dashboard -> Conversational AI -> Phone Numbers. This is the ElevenLabs id of the number, not the number itself. Belongs to the DEFAULT call profile, together with the Agent ID above.',
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
          'How the DEFAULT profile phone number is wired at ElevenLabs. It selects which outbound-call endpoint is used; leave it on Twilio unless the number is on a SIP trunk. Named profiles carry their own value.',
      },
      {
        key: 'defaultCallerId',
        label: 'Default Caller ID',
        type: 'text',
        required: false,
        placeholder: '+48123456789',
        helpText:
          'Optional number presented to the person called by the DEFAULT profile. Set per tenant, never per workflow — who is calling is a compliance decision.',
      },
      {
        key: 'callRecordingEnabled',
        label: 'Record Calls',
        type: 'boolean',
        required: false,
        helpText:
          'Applies to the DEFAULT profile. Leave unset to use whatever the ElevenLabs agent is configured to do. Recording a call is regulated in most jurisdictions; enabling it here does not by itself satisfy a notice or consent obligation.',
      },
      {
        key: PROFILES_CREDENTIAL_KEY,
        label: 'Call Profiles (JSON)',
        type: 'text',
        required: false,
        placeholder:
          '[{"name":"survey","agentId":"agent_...","phoneNumberId":"phnum_..."}]',
        helpText:
          'Extra named profiles, for running several voice agents from one ElevenLabs account. A JSON list of {"name","agentId","phoneNumberId"} plus the optional "telephonyProvider" ("twilio" | "sip_trunk"), "defaultCallerId" and "callRecordingEnabled". An agent picks a profile BY NAME, so rotating an ElevenLabs agent is an edit here rather than an edit of every workflow that dials it, and an agent naming a profile you have not defined fails before the call is placed instead of dialling the wrong one. The fields above are the "default" profile and keep working untouched — leave this blank if one agent and one number is all you need. Do NOT put secrets here: unlike the API key and webhook secret, this field is shown in full when the form is reloaded. Adding profiles never changes the callback URL — that one is per connector.',
      },
    ],
  },
  healthCheck: { service: 'elevenLabsVoiceHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
