/**
 * The generic HTTP/webhook connector — an `ExternalAgentConnector` with no
 * provider knowledge at all.
 *
 * ─── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 *
 * Any service whose contract is "POST to start, webhook to finish" can be driven
 * from a workflow through this connector by CONFIGURATION alone: a start URL, an
 * auth header, a body template, a shared signing secret and a path to the answer,
 * all held per tenant in the `integrations` credential store. No code, no second
 * package, no deploy.
 *
 * It exists to prove the seam is not shaped like the one provider that was built
 * on it first. Every provider-specific thing the voice connector needs — a
 * telephony endpoint, named call profiles, a documented HMAC canonical string, a
 * static workspace-level webhook — is absent here, and the platform's half is
 * unchanged.
 *
 * ─── IT USES THE PER-RUN TOKEN ROUTE, WHICH IS THE POINT ─────────────────────
 *
 * `agent_elevenlabs` had to be settled through the STATIC, connector-addressed
 * callback route, because ElevenLabs configures its webhook destination at the
 * workspace level and the outbound-call body has no field to put a per-call URL
 * in. This connector is the opposite and the DESIGN'S PRIMARY case: the provider
 * is handed `callbackUrl` in its own start request, so the answer comes back to
 * `POST /api/agent_orchestrator/external-runs/[token]/callback`, addressed by the
 * single-use bearer the runner minted for THAT run.
 *
 * The consequence is visible in what is missing below: there is no
 * `extractExternalRunId`. That member exists only so a provider that cannot accept
 * a per-run URL can still self-address, and implementing it is what OPTS a
 * connector in to the weaker static route. A token-addressed connector needs
 * strictly fewer members, and omitting it means the static route answers 404 for
 * this connector id — which is correct, because nothing should be settled here on
 * a signature alone.
 *
 * ─── CANCEL IS DELIBERATELY NOT IMPLEMENTED ──────────────────────────────────
 *
 * There is no cross-provider way to abort a run, and a *configurable* cancel URL
 * would be worse than none: `cancel` is declared per CONNECTOR, not per tenant, so
 * a tenant that configured no cancel endpoint would silently no-op — and the
 * deadline sweep would log "cancelled" for a run that is still executing and still
 * billing. T2.7 already handles a connector without one, and an honest "we stopped
 * waiting" beats a false "we called it off". A provider that DOES expose an abort
 * endpoint deserves its own connector, which is what this seam is for.
 *
 * ─── MOCK IS IMPLEMENTED, UNLIKE THE VOICE CONNECTOR ─────────────────────────
 *
 * `agent_elevenlabs` omits `mock` because a fabricated transcript is
 * indistinguishable downstream from something a human said, and because dialling
 * during an eval replay makes a phone ring. Here the honest would-do is genuinely
 * available: the connector can say WHAT it would post without inventing an answer,
 * and the runner nests a would-do under `wouldDo` where nothing can read it as an
 * outcome. So an eval suite that includes an HTTP agent replays without touching
 * the provider, instead of refusing.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import type {
  ExternalAgentConnector,
  ExternalAgentConnectorCallbackScope,
  ExternalAgentConnectorStartArgs,
  ExternalAgentConnectorStartResult,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import type { HostLookup } from '@open-mercato/shared/lib/url-safety'
import { httpAgentInputSchema, type HttpAgentInput } from '../data/validators'
import { GenericHttpApiError, postStartRequest, type GenericHttpFetch } from './api'
import { describeCredentialsForLog, redactSecrets, type GenericHttpCredentials } from './credentials'
import type { ReadGenericHttpCredentials } from './credentialsReader'
import { readJsonPath } from './jsonPath'
import { normalizeGenericHttpCallback } from './normalize'
import { verifyGenericHttpSignature } from './signature'
import { renderRequestTemplate } from './template'

const logger = createLogger('agent_http').child({ component: 'generic-connector' })

/** Stable connector id — referenced by `defineExternalAgent({ connectorId })` and by every correlation row. */
export const GENERIC_HTTP_CONNECTOR_ID = 'http.generic'

export type GenericHttpConnectorDeps = {
  readCredentials: ReadGenericHttpCredentials
  /** Injected for tests; defaults to the platform's DNS-pinned outbound fetch. */
  fetchImpl?: GenericHttpFetch
  /** Injected for tests, so no unit test performs a DNS lookup. */
  lookupHost?: HostLookup
}

export class GenericHttpConfigError extends Error {
  readonly code = 'AGENT_HTTP_CONFIG_INVALID'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'GenericHttpConfigError'
  }
}

export class GenericHttpStartRejectedError extends Error {
  readonly code = 'AGENT_HTTP_START_REJECTED'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'GenericHttpStartRejectedError'
  }
}

export function createGenericHttpConnector(deps: GenericHttpConnectorDeps): ExternalAgentConnector {
  return {
    id: GENERIC_HTTP_CONNECTOR_ID,

    async start(args: ExternalAgentConnectorStartArgs): Promise<ExternalAgentConnectorStartResult> {
      assertNoProfile(args)
      const input = parseHttpAgentInput(args.input, args.agentEntry.id)
      // The container the RUNNER holds, so this read costs no second container
      // (T2.9's seam gap, closed additively by T4.1). The reader falls back to
      // building one when a caller has none.
      const credentials = await deps.readCredentials(args.scope, args.container)

      const body = renderRequestTemplate(credentials.requestTemplate, {
        input,
        callbackUrl: args.callbackUrl,
        callbackToken: args.callbackToken,
      })

      let response: Awaited<ReturnType<typeof postStartRequest>>
      try {
        response = await postStartRequest({
          url: credentials.startUrl,
          headers: buildAuthHeaders(credentials),
          body,
          fetchImpl: deps.fetchImpl,
          lookupHost: deps.lookupHost,
        })
      } catch (error) {
        // The ONE place a provider's own words are surfaced, and therefore the one
        // place they are redacted. An error body can echo the request's auth header
        // back, and this message is persisted on the run and rendered in the
        // cockpit — the sibling voice connector shipped exactly that leak before it
        // was caught.
        throw rethrowWithRedactedHint(error, credentials)
      }

      const externalRunId = readExternalRunId(response.payload, credentials.externalRunIdPath)
      if (!externalRunId) {
        // Without the provider's own id there is nothing to correlate a late
        // failure with, nothing to cancel and nothing to reconcile by hand. It is a
        // failed start, not a suspended run: the alternative parks a workflow on a
        // request whose fate is unobservable.
        throw new GenericHttpStartRejectedError(
          `the configured HTTP agent endpoint accepted the start request but returned nothing at the configured external run id path "${credentials.externalRunIdPath}"`,
        )
      }

      logger.info('started an external HTTP agent run', {
        agentId: args.agentEntry.id,
        externalRunId,
        ...describeCredentialsForLog(credentials),
        // Never logged: the callback URL (its path carries the single-use bearer),
        // the callback token, the rendered body (it carries the brief) and the auth
        // header value.
      })

      return { externalRunId, expectsCallback: true }
    },

    async verifyCallback(
      headers: Headers,
      rawBody: string,
      scope: ExternalAgentConnectorCallbackScope,
    ): Promise<boolean> {
      const credentials = await deps.readCredentials(scope, scope.container)
      return verifyGenericHttpSignature({
        // `Headers.get` is case-insensitive, so the configured header name matches
        // however the provider capitalised it on the wire.
        header: headers.get(credentials.signatureHeader),
        // The exact received body string, passed straight through: re-serialising
        // it here would break every real signature.
        rawBody,
        secret: credentials.signingSecret,
        scheme: credentials.signatureScheme,
      })
    },

    /**
     * Where the answer lives is a per-tenant credential, so this needs the tenancy
     * the platform resolved — which is why `normalize` takes a context argument at
     * all (added by T4.1, optional, ignored by every connector whose mapping is
     * fixed by its provider).
     */
    async normalize(rawPayload: unknown, context?: ExternalAgentConnectorCallbackScope): Promise<unknown> {
      if (!context) {
        // Fail rather than guess: a default path would silently settle runs with
        // whatever happened to sit at `result.answer` on a tenant that configured
        // something else.
        throw new GenericHttpConfigError(
          'the generic HTTP connector was asked to normalize a callback without a tenant context, so it cannot read the configured result path',
        )
      }
      const credentials = await deps.readCredentials(context, context.container)
      return normalizeGenericHttpCallback(rawPayload, credentials.resultPath)
    },

    /**
     * The would-do for dry runs and eval replays. It describes the request and
     * NEVER an answer: the runner nests whatever this returns under `wouldDo`, so
     * nothing downstream can read it as an outcome even if it wanted to.
     *
     * It is synchronous by interface, so it cannot read the tenant's credentials
     * and cannot name the URL it would post to — it names the agent, the shape and
     * the input keys instead. The callback token is deliberately absent (the runner
     * passes a placeholder here anyway, and a would-do that printed a bearer would
     * be a bad habit to establish).
     */
    mock(args: ExternalAgentConnectorStartArgs): unknown {
      return {
        connectorId: GENERIC_HTTP_CONNECTOR_ID,
        agentId: args.agentEntry.id,
        wouldPost: {
          to: "this tenant's configured HTTP agent start URL",
          method: 'POST',
          inputKeys: Object.keys((args.input ?? {}) as Record<string, unknown>)
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          callbackUrl: args.callbackUrl,
        },
      }
    },
  }
}

/**
 * FAIL CLOSED on a named profile.
 *
 * `defineExternalAgent({ profile })` is a real interface member and this connector
 * genuinely cannot honour it: a profile could vary the START half, but the
 * callback half — the signing secret, the scheme, the result path — is addressed
 * by TENANT only, because `verifyCallback` and `normalize` are reached from a
 * callback that knows a run, not an agent. Honouring the start half alone would
 * mean posting to endpoint B and reading its answer as though it came from
 * endpoint A. Refusing before the request is the same stance the voice connector
 * takes on an unconfigured profile, for the same reason: nothing happened, and
 * here is what to do instead.
 */
function assertNoProfile(args: ExternalAgentConnectorStartArgs): void {
  const profile = args.agentEntry.profile
  if (!profile) return
  throw new GenericHttpConfigError(
    `external agent "${args.agentEntry.id}" declares the connector profile "${profile}", which the generic HTTP connector cannot serve: its callback verification and result mapping are configured per tenant, not per agent. Register a second connector for a second endpoint.`,
  )
}

export function parseHttpAgentInput(input: unknown, agentId: string): HttpAgentInput {
  const parsed = httpAgentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new GenericHttpConfigError(
      `external agent "${agentId}" received an input the HTTP connector cannot send: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

function buildAuthHeaders(credentials: GenericHttpCredentials): Record<string, string> {
  if (!credentials.authHeaderValue) return {}
  return { [credentials.authHeaderName]: credentials.authHeaderValue }
}

/**
 * The provider's run id, from wherever the tenant said it is. A number is accepted
 * and stringified — plenty of APIs answer `{"id": 4211}` — but an object is not:
 * it has no single reading, and the value becomes a correlation key.
 */
function readExternalRunId(payload: unknown, path: string): string | null {
  const found = readJsonPath(payload, path)
  if (typeof found === 'string') return found.trim() || null
  if (typeof found === 'number' && Number.isFinite(found)) return String(found)
  return null
}

function rethrowWithRedactedHint(error: unknown, credentials: GenericHttpCredentials): unknown {
  if (!(error instanceof GenericHttpApiError) || !error.bodyHint) return error
  return new GenericHttpStartRejectedError(
    `${stripInternalPrefix(error.message)}: ${redactSecrets(error.bodyHint, credentials)}`,
  )
}

/** Avoid a doubled `[internal]` marker when one error's message is wrapped by another's. */
function stripInternalPrefix(message: string): string {
  return message.startsWith('[internal] ') ? message.slice('[internal] '.length) : message
}
