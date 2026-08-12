/**
 * The generic HTTP agent entry in the integrations marketplace: everything an
 * operator configures, per tenant, before a workflow can reach their service.
 *
 * This descriptor IS the connector's configuration surface — there is no code
 * anywhere in this package that knows a particular provider — so the field list
 * below is the whole contract between Open Mercato and whatever is on the other
 * end.
 *
 * THE TWO `secret` FIELDS ARE THE ONES THAT MATTER. Everything in a credential
 * record is encrypted at rest by the credential store regardless of type; `secret`
 * is what keeps a value masked in the admin UI and redacted out of the read-back
 * API. The auth header value and the callback signing secret are the only two
 * values here that would let someone else start runs on this tenant's provider or
 * forge a settlement, so they are the only two typed `secret`. In particular the
 * body template is `text` and IS shown in full on reload — which is why its help
 * text says not to put a key in it.
 */

import type {
  IntegrationBundle,
  IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'
import { REQUEST_TEMPLATE_CREDENTIAL_KEY } from './lib/credentials'

export const AGENT_HTTP_INTEGRATION_ID = 'agent_http'

export const integration: IntegrationDefinition = {
  id: AGENT_HTTP_INTEGRATION_ID,
  title: 'HTTP Agent (generic webhook)',
  description:
    'Run an external agent on any service that starts with an HTTP POST and answers later with a signed webhook. Configured entirely here — no provider-specific code.',
  // `webhook`, not `other`: the callback half IS an inbound webhook, and that is
  // the category an operator looking for "the thing that posts back to us" opens.
  category: 'webhook',
  providerKey: 'http',
  package: '@open-mercato/agent-http',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['agents', 'webhook', 'http', 'external-agent'],
  credentials: {
    fields: [
      {
        key: 'startUrl',
        label: 'Start URL',
        type: 'text',
        required: true,
        placeholder: 'https://provider.example.com/v1/runs',
        helpText:
          'The endpoint this connector POSTs to when a workflow reaches the agent. It must be reachable from the internet-facing side of your deployment: private, loopback and link-local addresses are refused, redirects are not followed, and the connection is pinned to the address that was validated. Workflows cannot override it — the URL is deliberately configuration, never node input.',
      },
      {
        key: 'authHeaderName',
        label: 'Auth Header Name',
        type: 'text',
        required: false,
        placeholder: 'Authorization',
        helpText:
          'Header the value below travels in. Defaults to Authorization. Ignored when no value is set.',
      },
      {
        key: 'authHeaderValue',
        label: 'Auth Header Value',
        type: 'secret',
        required: false,
        placeholder: 'Bearer sk_live_...',
        helpText:
          'Sent verbatim on every start request, including any "Bearer " prefix your provider expects. Leave blank for a provider that authenticates some other way.',
      },
      {
        key: 'signingSecret',
        label: 'Callback Signing Secret',
        type: 'secret',
        required: true,
        helpText:
          'Shared secret your provider signs its callback with: HMAC-SHA256 over the RAW request body, presented in the header named below. Required — an unsigned callback would let anyone who ever saw a callback URL settle that run with an answer of their choosing.',
      },
      {
        key: 'signatureHeader',
        label: 'Signature Header',
        type: 'text',
        required: false,
        placeholder: 'x-om-signature',
        helpText:
          'Header your provider presents the HMAC in. Case does not matter. Defaults to x-om-signature.',
      },
      {
        key: 'signatureScheme',
        label: 'Signature Scheme',
        type: 'select',
        required: false,
        options: [
          { value: 'hex', label: 'Hex digest (abc123...)' },
          { value: 'sha256_prefix', label: 'Prefixed (sha256=abc123...)' },
        ],
        helpText:
          'How the digest is presented. Pick the one your provider documents: a mismatch here rejects every callback silently, and the run then parks until its deadline. Several comma-separated values are accepted, so a provider rotating its secret does not drop callbacks.',
      },
      {
        key: 'resultPath',
        label: 'Result Path',
        type: 'text',
        required: false,
        placeholder: 'result.answer',
        helpText:
          'Where the answer sits inside your provider\'s callback body, as a dot path — "result.answer", "data.0.output.text". It must point at a scalar; an object has no single reading. Defaults to result.answer.',
      },
      {
        key: 'externalRunIdPath',
        label: 'External Run Id Path',
        type: 'text',
        required: false,
        placeholder: 'id',
        helpText:
          'Where your provider\'s own run id sits in its START response, as a dot path. It is stored on the correlation row so a run can be traced back on your side. A start whose response carries nothing there fails rather than parking a workflow on a request nobody can look up. Defaults to id.',
      },
      {
        key: REQUEST_TEMPLATE_CREDENTIAL_KEY,
        label: 'Request Body Template (JSON)',
        type: 'text',
        required: false,
        placeholder:
          '{"question":"{{input.brief}}","webhook":{"url":"{{callbackUrl}}","token":"{{callbackToken}}"}}',
        helpText:
          'The JSON body to POST, with placeholders: {{input}}, {{input.<path>}}, {{callbackUrl}} and {{callbackToken}}. A value that is exactly one placeholder keeps its type, so {{input.payload.deal}} forwards the object itself; a placeholder inside a longer string interpolates as text. Your provider MUST receive {{callbackUrl}} — that per-run URL is the only way its answer gets back — and must POST its result there. Leave blank for {"input":…,"callbackUrl":…,"callbackToken":…}. Do NOT put a key in here: unlike the two secret fields, this one is shown in full when the form is reloaded.',
      },
    ],
  },
  healthCheck: { service: 'genericHttpAgentHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
