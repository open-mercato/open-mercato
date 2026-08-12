/**
 * How the connector reaches THIS TENANT'S credentials.
 *
 * ─── THE SEAM, AND WHY IT IS SHAPED THIS WAY ─────────────────────────────────
 *
 * `ExternalAgentConnector` is a plain object registered ONCE per process, while a
 * credential read is per tenant, so the container has to arrive with the CALL.
 * Since T4.1 all three entry points carry an optional one:
 *
 *   start({ …, scope, container? })
 *   verifyCallback(headers, rawBody, { …scope, container? })
 *   normalize(rawPayload, { …scope, container? })
 *
 * That optional field is the whole fix. The obvious alternative — closing over the
 * container `di.ts` was registered with — is WRONG: `register(container)` runs
 * inside `createRequestContainer()`, i.e. once per REQUEST, against a freshly
 * forked `em`, so a captured container reads every later tenant's credentials
 * through an entity manager belonging to a finished request. That is an
 * identity-map and RequestContext hazard which surfaces as intermittent stale
 * reads long after the code that caused it.
 *
 * It stays OPTIONAL because a connector may be driven by a caller that holds no
 * container, so this reader falls back to building one — which is exactly what the
 * voice connector had to do on EVERY read before the field existed. The fallback
 * is correctness insurance, not the normal path.
 *
 * The factory is injectable so `connector.ts` can be unit-tested with a fake
 * reader and never touches a database.
 */

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ExternalAgentConnectorContainer } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import { AGENT_HTTP_INTEGRATION_ID } from '../integration'
import {
  parseGenericHttpCredentials,
  type GenericHttpCredentials,
  type GenericHttpScope,
  type IntegrationCredentialsReader,
} from './credentials'

export type ReadGenericHttpCredentials = (
  scope: GenericHttpScope,
  container?: ExternalAgentConnectorContainer,
) => Promise<GenericHttpCredentials>

export function createGenericHttpCredentialsReader(): ReadGenericHttpCredentials {
  return async (scope, container) => {
    const resolved = container ?? (await createRequestContainer())
    const service = resolved.resolve('integrationCredentialsService') as IntegrationCredentialsReader
    const raw = await service.resolve(AGENT_HTTP_INTEGRATION_ID, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return parseGenericHttpCredentials(raw)
  }
}
