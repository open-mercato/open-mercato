/**
 * The example external agent — the wiring an operator copies, and a working agent
 * in its own right.
 *
 * It registers separately from the connector (which registers in `di.ts`), because
 * this file's side effect only runs behind `ensureAgentsLoaded()` while the
 * unauthenticated callback route needs the connector without the agent registry.
 *
 * WHAT THIS AGENT DEMONSTRATES, and what a tenant changes to make its own:
 *
 *   - `connectorId` names the generic connector; the ENDPOINT it reaches is the
 *     tenant's credential, so the same registration runs unmodified on every
 *     tenant while each talks to its own service;
 *   - `result.schema` is the ENVELOPE (`{ kind, data }`), which is what
 *     `resolveAgentOutcomeZod` reads to project the OUTCOME contract — so
 *     `outputMapping: { answer: 'data.answer' }` autocompletes and typechecks in
 *     the Studio's variable picker rather than resolving to `unknown`;
 *   - `timeout` is mandatory: without a deadline, a provider that never calls back
 *     parks the workflow forever (design R2). The sweep fails the run and wakes the
 *     step down the `error` handle when it expires;
 *   - NO `profile`. The generic connector refuses one, because its callback half is
 *     configured per tenant and could not follow a per-agent endpoint.
 *
 * A tenant wanting a SECOND HTTP agent against the SAME service registers another
 * `defineExternalAgent` with a different id and its own outcome documentation;
 * against a DIFFERENT service, it needs a second registered connector, since the
 * signing secret and the result path are per (tenant, connector).
 */

import { defineExternalAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineExternalAgent'
import { httpAgentResultSchema } from './data/validators'
import { GENERIC_HTTP_CONNECTOR_ID } from './lib/connector'

export const HTTP_RESEARCHER_AGENT_ID = 'http.remote_researcher'

defineExternalAgent({
  id: HTTP_RESEARCHER_AGENT_ID,
  moduleId: 'agent_http',
  label: 'Ask a remote HTTP service and wait for its answer',
  description:
    'Starts a run on the tenant-configured HTTP endpoint, parks the workflow step, and resumes it with the answer the service posts back to the per-run callback URL.',
  connectorId: GENERIC_HTTP_CONNECTOR_ID,
  agentType: 'researcher',
  // RESEARCHER, and structurally unable to be anything else: `defineExternalAgent`
  // rejects a proposal-kind external agent, because a third party's self-reported
  // confidence must never clear `autoApproveThreshold` on a domain write. This
  // agent reports what a remote service said; the NEXT (native) agent proposes.
  result: { kind: 'researcher', schema: httpAgentResultSchema },
  timeout: '30m',
  instructions: [
    'Runs at whatever service the tenant configured under Integrations -> HTTP Agent',
    '(generic webhook). Nothing about the service is known to this package: the start URL,',
    'the auth header, the request body and the path to the answer are all credentials.',
    '',
    'The contract the remote service must honour is short. It receives a POST built from',
    'the configured body template, which MUST include {{callbackUrl}}; it answers 2xx with',
    'its own run id at the configured External Run Id Path; and when it has an answer it',
    'POSTs that answer to the callback URL, signed HMAC-SHA256 over the raw body with the',
    'configured signing secret. The callback URL is single-use and addresses this run only.',
    '',
    'The node input carries `brief` (the question) and `payload` (anything else the body',
    'template references). It carries no URL or header: where the request goes is tenant',
    'configuration, never workflow input.',
    '',
    'The answer comes back as `data.answer`, a single string read from the configured',
    'Result Path. A provider that answers nothing there fails the run down the `error`',
    'handle rather than resuming with an empty answer.',
  ].join(' '),
  sampleInput: {
    brief:
      'Summarise what changed in the ACME renewal account since last quarter, and flag anything that puts the renewal at risk.',
    payload: {
      accountId: 'acc_4211',
      quarter: '2026-Q3',
    },
  },
})
