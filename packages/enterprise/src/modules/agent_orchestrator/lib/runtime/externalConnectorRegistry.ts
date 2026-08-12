/**
 * Registry of external agent connectors (external-agent-invocation design §5.3).
 *
 * A connector is the seam a third-party agent provider plugs into: it knows how
 * to KICK OFF a run on the provider, how to VERIFY the provider's callback, and
 * how to NORMALIZE the provider's payload into the agent's declared OUTCOME
 * shape. Everything else — the `AgentRun` row, the trace, the guardrails, the
 * cockpit, the eval overlay, the workflow park/resume — is the platform's and is
 * identical for every connector.
 *
 * Shape and rules are deliberately modelled on the webhooks module's
 * `registerWebhookEndpointAdapter` (`packages/webhooks/src/modules/webhooks/lib/adapter-registry.ts`),
 * so the two are learnable as ONE pattern: a provider owns its adapter, the
 * adapter owns verification, and the receiving route owns nothing provider-specific.
 * The duplicate-id guard instead follows the agent registry
 * (`lib/sdk/defineAgent.ts`) — see `registerExternalAgentConnector` for why the
 * webhooks "last registration wins" behaviour is the wrong default here.
 *
 * WHERE A PROVIDER REGISTERS ITS CONNECTOR: in the provider module's `di.ts`
 * `register(container)`, exactly like a webhook endpoint adapter. That runs in
 * EVERY process that builds a container — the Next server that serves the
 * unauthenticated callback route, and the queue worker that starts and sweeps
 * the run — whereas an `ai-agents.ts` import side effect only runs behind
 * `ensureAgentsLoaded()`. The agent itself still registers from `ai-agents.ts`
 * via `defineExternalAgent`; the two registrations are independent on purpose,
 * because the callback route needs the connector without needing the registry.
 */

import type { AgentRegistryEntry } from '../sdk/defineAgent'

/** Tenancy of one external run. Both ids are always known — never derive them from a callback body. */
export type ExternalAgentConnectorScope = {
  tenantId: string
  organizationId: string
}

export interface ExternalAgentConnectorStartArgs {
  /** The registered agent being run, so the connector can read its own authoring fields. */
  agentEntry: AgentRegistryEntry
  /** The `INVOKE_AGENT` input, already interpolated by the workflow engine. */
  input: unknown
  /** Absolute URL the provider posts its result to. */
  callbackUrl: string
  /**
   * PLAINTEXT single-use bearer handed to the provider. It is NEVER persisted:
   * `agent_external_runs.callback_token_hash` stores only its lowercase SHA-256
   * hex digest (T2.1), so a dump of that table yields no forgeable callback.
   */
  callbackToken: string
  scope: ExternalAgentConnectorScope
}

/**
 * What `start()` reports back.
 *
 * `expectsCallback: true` is the normal, valuable case: the run stays `running`,
 * the workflow step stays parked, and the provider's callback settles it later.
 * `expectsCallback: false` is the escape hatch for a provider that genuinely
 * answers within the call — the runner completes such a run inline and no
 * `agent_external_runs` correlation row needs a resume triple.
 */
export type ExternalAgentConnectorStartResult =
  | { externalRunId: string; expectsCallback: true }
  | { externalRunId: string; expectsCallback: false; result: unknown }

export interface ExternalAgentConnector {
  /** Stable connector id referenced by `defineExternalAgent({ connectorId })`, e.g. `'elevenlabs.voice'`. */
  id: string

  /**
   * Kick off the external run and return AS SOON AS the provider has accepted it.
   *
   * MUST NOT block on completion. A connector that polls until the external run
   * finishes pins a `workflow-invoke-agent` worker slot for the whole duration,
   * which re-creates exactly the problem the design rejects in Option 1: a
   * handful of concurrent six-minute phone calls stall the queue, and a deploy
   * mid-call loses the run while the provider still calls back into nothing.
   * Suspend-and-resume is the entire point of this seam — polling defeats it.
   */
  start(args: ExternalAgentConnectorStartArgs): Promise<ExternalAgentConnectorStartResult>

  /**
   * Verify the provider's callback signature over the RAW body.
   *
   * Verification lives HERE and never in the callback route — the same rule the
   * webhooks module states for inbound adapters. Only the provider's own package
   * knows its signing scheme (header name, canonical string, digest encoding,
   * replay window), and a route that tried to generalise it would end up with a
   * lowest-common-denominator check that is weaker than every provider's.
   *
   * The raw body is passed as a string because a signature covers the bytes that
   * were sent: never JSON-parse before verifying, or a re-serialised body breaks
   * the digest (and a parse of unverified input is itself attack surface).
   *
   * `scope` is the scope of the ALREADY-RESOLVED correlation row (looked up by
   * token hash), so a connector can check the signature against that tenant's
   * secret. It is never derived from the callback body.
   */
  verifyCallback(
    headers: Headers,
    rawBody: string,
    scope: ExternalAgentConnectorScope,
  ): Promise<boolean> | boolean

  /** Provider payload → the agent's declared OUTCOME shape. Called only AFTER `verifyCallback`. */
  normalize(rawPayload: unknown): unknown

  /**
   * Optional: extract the PROVIDER's own run id from a raw callback payload, so a
   * callback that carries no per-run token can still find its correlation row.
   *
   * WHY THIS IS NOT REDUNDANT WITH THE TOKEN. The primary route
   * (`external-runs/[token]/callback`) addresses a run by a single-use bearer the
   * runner minted and handed to the provider at `start()`. That is the stronger
   * design and stays the default — but it only works for a provider that accepts
   * a per-call callback URL. ElevenLabs does not: its post-call webhook
   * destination is configured at the WORKSPACE/AGENT level and the outbound-call
   * request body has no webhook field, so the per-run URL can never be delivered
   * and no callback would ever arrive at the token route. Such a provider posts
   * every tenant's answer to one static URL, and the only thing in the payload
   * that identifies the run is the provider's own id (an ElevenLabs
   * `conversation_id`) — which is exactly what `start()` returned as
   * `externalRunId` and what the correlation row already indexes under
   * `(organization_id, connector_id, external_run_id)`.
   *
   * Implementing it OPTS THE CONNECTOR IN to the second, static entry point
   * (`external-runs/connectors/[connectorId]/callback`). A connector that cannot
   * self-address simply omits it and stays token-addressed; the static route
   * answers 404 for it, so opting in is always explicit.
   *
   * CONTRACT. The argument is the PARSED body (same as `normalize`), parsed
   * before any signature has been checked — so an implementation must be a cheap,
   * total, shallow read that never throws and never interprets the payload.
   * Return `null` for anything it cannot address. The id is used only as a
   * database lookup key: the tenancy that authorises the settlement still comes
   * from the row, and the row is only accepted once THIS tenant's signature has
   * verified over the raw bytes.
   */
  extractExternalRunId?(rawPayload: unknown): string | null

  /**
   * Optional: cancel/hang up the external run when the step is cancelled or the
   * callback deadline passes. A connector without it simply leaves the provider
   * to finish on its own; the platform still fails the run and resumes the
   * workflow down the `error` handle.
   */
  cancel?(externalRunId: string, scope: ExternalAgentConnectorScope): Promise<void>

  /**
   * Optional simulation for the dry-run and eval paths.
   *
   * DEFAULT WHEN ABSENT IS REFUSE, not a synthesised payload — the same choice
   * `CALL_API` and `EXECUTE_FUNCTION` make with `mock: 'refuse'` in core's
   * activity registry, and for a stronger reason. An external run has a real
   * side effect in the world (a phone rings), so a connector that has not
   * thought about simulation MUST NOT dial: `evalReplayService` calls
   * `agentRuntime.run()` for real, so replaying fifty eval cases against a voice
   * agent would place fifty real calls. And the platform must not invent the
   * payload either: a fabricated transcript is indistinguishable downstream from
   * one a human actually said, so an eval would grade a fiction and a planning
   * agent would act on it. Refusing is the only honest answer the platform can
   * give on a connector's behalf.
   *
   * A connector that DOES implement `mock` returns a would-do payload naming the
   * call it would have placed — never a fabricated outcome — following
   * `buildInvokeAgentWouldDo`'s convention of marking the envelope simulated so
   * nothing downstream can mistake it for something that happened.
   */
  mock?(args: ExternalAgentConnectorStartArgs): unknown
}

/**
 * Path of the STATIC, connector-addressed callback route — one stable URL per
 * connector, pasted once into the provider's own workspace webhook settings.
 *
 * Declared next to the interface for the same reason
 * `buildExternalRunCallbackPath` sits next to the token hash: the path an
 * operator is told to paste and the path this deployment actually serves must be
 * the same string, and a drift between them is only discovered when a real call
 * comes back to a 404. A connector's integration help text builds its URL from
 * here rather than spelling it out.
 */
export function buildExternalConnectorCallbackPath(connectorId: string): string {
  return `/api/agent_orchestrator/external-runs/connectors/${encodeURIComponent(connectorId)}/callback`
}

const registry = new Map<string, ExternalAgentConnector>()

/**
 * Register a connector. Duplicate ids THROW, matching `defineAgent` /
 * `registerFileAgent` rather than the webhooks registry's silent last-wins
 * overwrite: a connector id is what the callback route resolves a verifier
 * from, so a second package quietly taking over `'elevenlabs.voice'` would be
 * handed every inbound callback for that provider — a signature-verification
 * takeover, not a configuration preference. Fail loudly at import time instead.
 */
export function registerExternalAgentConnector(connector: ExternalAgentConnector): void {
  if (registry.has(connector.id)) {
    throw new Error(`[internal] duplicate external agent connector id "${connector.id}"`)
  }
  registry.set(connector.id, connector)
}

export function getExternalAgentConnector(id: string): ExternalAgentConnector | undefined {
  return registry.get(id)
}

export function listExternalAgentConnectors(): ExternalAgentConnector[] {
  return [...registry.values()]
}

/** Test-only reset, mirroring `clearWebhookEndpointAdapters`. Never call from product code. */
export function clearExternalAgentConnectorsForTests(): void {
  registry.clear()
}
