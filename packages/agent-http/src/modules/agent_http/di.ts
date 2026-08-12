/**
 * Where the CONNECTOR is registered — deliberately here and not in `ai-agents.ts`.
 *
 * `register()` runs in every process that builds a container: the Next server that
 * serves the unauthenticated callback route AND the queue worker that starts and
 * sweeps runs. An `ai-agents.ts` import side effect only runs behind
 * `ensureAgentsLoaded()`, which the callback route never calls — and that route
 * needs the connector (to verify a signature and to map the answer) without
 * needing the agent registry at all. The AGENT registers separately.
 *
 * IDEMPOTENCE IS REQUIRED HERE. `createRequestContainer()` replays every module's
 * `register()` on every request, while `registerExternalAgentConnector` THROWS on
 * a duplicate id. That hard throw is correct — a second package quietly claiming
 * `http.generic` would be handed every inbound callback for it, which is a
 * verification takeover — so this function asks the registry first.
 *
 * NOTE WHAT IS **NOT** CAPTURED: no container. The connector reads credentials
 * through the container handed to it per call; capturing this one would bind every
 * later tenant's read to a request that has finished.
 */

import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  getExternalAgentConnector,
  registerExternalAgentConnector,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import { createGenericHttpConnector, GENERIC_HTTP_CONNECTOR_ID } from './lib/connector'
import { createGenericHttpCredentialsReader } from './lib/credentialsReader'
import { genericHttpAgentHealthCheck } from './lib/health'

export function register(container: AppContainer) {
  if (!getExternalAgentConnector(GENERIC_HTTP_CONNECTOR_ID)) {
    registerExternalAgentConnector(
      createGenericHttpConnector({
        readCredentials: createGenericHttpCredentialsReader(),
      }),
    )
  }

  container.register({
    // The key must match `integration.ts`'s `healthCheck.service` exactly, or the
    // hub's resolve throws and the integration reads as permanently unhealthy.
    genericHttpAgentHealthCheck: asValue(genericHttpAgentHealthCheck),
  })
}
