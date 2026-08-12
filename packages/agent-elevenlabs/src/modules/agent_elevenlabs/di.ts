/**
 * Where the CONNECTOR is registered — deliberately here and not in
 * `ai-agents.ts`.
 *
 * `register()` runs in every process that builds a container: the Next server
 * that serves the unauthenticated callback route AND the queue worker that
 * starts and sweeps runs. An `ai-agents.ts` import side effect only runs behind
 * `ensureAgentsLoaded()`, which the callback route never calls — and the callback
 * route needs the connector (to verify a signature) without needing the agent
 * registry at all. The AGENT registers separately, from `ai-agents.ts`.
 *
 * IDEMPOTENCE IS REQUIRED HERE. `createRequestContainer()` replays every
 * module's `register()` on every request, while
 * `registerExternalAgentConnector` THROWS on a duplicate id — that hard throw is
 * correct (a second package quietly claiming `elevenlabs.voice` would be handed
 * every inbound callback for this provider, which is a verification takeover),
 * but it means this function must ask the registry first. The check reads the
 * same registry the duplicate guard writes to, so it stays correct even where
 * the bundler loads this module twice.
 */

import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  getExternalAgentConnector,
  registerExternalAgentConnector,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import {
  createElevenLabsVoiceConnector,
  ELEVENLABS_VOICE_CONNECTOR_ID,
} from './lib/connector'
import { createElevenLabsCredentialsReader } from './lib/credentialsReader'
import { elevenLabsVoiceHealthCheck } from './lib/health'

export function register(container: AppContainer) {
  if (!getExternalAgentConnector(ELEVENLABS_VOICE_CONNECTOR_ID)) {
    registerExternalAgentConnector(
      createElevenLabsVoiceConnector({
        // Credentials are resolved PER CALL under the run's own scope, never
        // captured here: the connector registry is process-global and must never
        // hold a tenant secret (design §7, R7).
        readCredentials: createElevenLabsCredentialsReader(),
      }),
    )
  }

  container.register({
    // The key must match `integration.ts`'s `healthCheck.service` exactly, or
    // the hub's resolve throws and the integration reads as permanently
    // unhealthy.
    elevenLabsVoiceHealthCheck: asValue(elevenLabsVoiceHealthCheck),
  })
}
