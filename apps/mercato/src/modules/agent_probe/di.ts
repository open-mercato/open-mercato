/**
 * The connector registers here rather than in `ai-agents.ts` for the reason the
 * registry documents: `register()` runs in every process that builds a container
 * — including the Next server that serves the unauthenticated callback routes,
 * which never calls `ensureAgentsLoaded()`. Idempotent, because
 * `createRequestContainer()` replays every module's `register()` per request while
 * `registerExternalAgentConnector` throws on a duplicate id.
 */

import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  getExternalAgentConnector,
  registerExternalAgentConnector,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import { createProbeConnector, PROBE_CONNECTOR_ID } from './lib/probeConnector'

export function register(_container: AppContainer) {
  if (!getExternalAgentConnector(PROBE_CONNECTOR_ID)) {
    registerExternalAgentConnector(createProbeConnector())
  }
}
