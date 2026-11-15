"use client"

import * as React from 'react'
import {
  getEnabledModuleIds,
  subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '../backend/BackendChromeProvider'

export const AI_ASSISTANT_MODULE_ID = 'ai_assistant'
export const AI_ASSISTANT_VIEW_FEATURE = 'ai_assistant.view'

function readEnabledModuleIds(): ReadonlySet<string> | null {
  return getEnabledModuleIds()
}

function readEnabledModuleIdsOnServer(): ReadonlySet<string> | null {
  return null
}

/**
 * Whether the AI assistant surfaces should mount at all.
 *
 * Every `/api/ai_assistant/*` route is gated on `ai_assistant.view`, and an
 * installation that does not enable the module has no such routes to answer.
 * Mounting the launcher or the conversation sync in either case only produces
 * 404s / 403s, so both call sites consult this first instead of probing.
 *
 * Two independent signals have to agree:
 *   - the client enabled-module registry, populated from the generated
 *     `enabled-module-ids.generated.ts` during client bootstrap. It registers
 *     asynchronously, so `null` means "not known yet", not "module absent".
 *   - `ai_assistant.view` in the backend chrome payload. The server already
 *     drops grants owned by disabled modules (and expands a superadmin `*`
 *     into enabled modules only), and the payload is fetched once and cached
 *     by `BackendChromeProvider`, so this costs no extra request. It stays
 *     fail-closed until the payload arrives, which is what keeps the cold-load
 *     window quiet.
 */
export function useAiAssistantAvailable(): boolean {
  const { payload } = useBackendChrome()
  const enabledModuleIds = React.useSyncExternalStore(
    subscribeToInjectionRegistryChanges,
    readEnabledModuleIds,
    readEnabledModuleIdsOnServer,
  )
  const moduleEnabled = enabledModuleIds === null || enabledModuleIds.has(AI_ASSISTANT_MODULE_ID)
  return moduleEnabled && hasFeature(payload?.grantedFeatures, AI_ASSISTANT_VIEW_FEATURE)
}
