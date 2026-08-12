/**
 * How the connector reaches THIS TENANT'S credentials — the one place where the
 * `ExternalAgentConnector` interface does not hand us what we need.
 *
 * THE SEAM GAP. `ExternalAgentConnector` is a plain object registered once per
 * process, and its three entry points carry no container:
 *
 *   start(args)                                  // args = agent, input, callbackUrl, callbackToken, scope
 *   verifyCallback(headers, rawBody, scope)      // scope only
 *   normalize(rawPayload)                        // nothing at all
 *
 * `verifyCallback` is the hard case: it MUST read the tenant's webhook secret to
 * check a signature, and it is called from the unauthenticated callback route,
 * in whichever process the provider happened to reach. `scope` is the tenancy of
 * the already-resolved correlation row, which is exactly what a credential
 * lookup needs — but there is no `em` and no container to look it up WITH.
 *
 * WHY NOT CLOSE OVER THE CONTAINER `di.ts` WAS REGISTERED WITH. That is the
 * obvious fix and it is wrong here. `register(container)` runs inside
 * `createRequestContainer()`, i.e. once per REQUEST, against a freshly forked
 * `em`. A connector that captured the first container would read every later
 * tenant's credentials through a stale entity manager belonging to a finished
 * request — an identity-map and RequestContext hazard that would surface as
 * intermittent stale reads long after the code that caused it.
 *
 * WHAT THIS DOES INSTEAD. It builds a container on demand, per credential read,
 * and resolves `integrationCredentialsService` from it. That keeps the read
 * inside DI (so an app's `modules.ts` override of that service still applies),
 * keeps two-column tenancy in the service where it belongs, and holds no
 * cross-request state. The cost is one container construction per external run
 * start and per callback — a handful per phone call, against a call that lasts
 * minutes.
 *
 * The factory is injectable so `connector.ts` can be unit-tested with a fake
 * reader and never touches a database.
 */

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ELEVENLABS_INTEGRATION_ID } from '../integration'
import {
  parseElevenLabsCredentials,
  type ElevenLabsCredentials,
  type ElevenLabsScope,
  type IntegrationCredentialsReader,
} from './credentials'

export type ReadElevenLabsCredentials = (scope: ElevenLabsScope) => Promise<ElevenLabsCredentials>

/**
 * Build the default reader. Every call constructs a request container, resolves
 * the credential service from it and reads the tenant's row.
 */
export function createElevenLabsCredentialsReader(): ReadElevenLabsCredentials {
  return async (scope) => {
    const container = await createRequestContainer()
    const service = container.resolve('integrationCredentialsService') as IntegrationCredentialsReader
    const raw = await service.resolve(ELEVENLABS_INTEGRATION_ID, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return parseElevenLabsCredentials(raw)
  }
}
