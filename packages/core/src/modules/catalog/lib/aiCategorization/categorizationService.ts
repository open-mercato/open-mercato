import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { AiCategorizationSettings } from '../../data/validators'
import { readAiCategorizationSettings } from '../aiCategorizationSettings'
import type { CatalogDecisionModelPort } from './decisionModelPort'

export const CATALOG_AI_CATEGORIZATION_MODULE_ID = 'catalog'

export type CatalogCategorizationStatus = {
  available: boolean
  /** Open string: the port's own reasons plus catalog's `not_installed`. */
  reason?: string
  enabled: boolean
  effective: boolean
  settings: AiCategorizationSettings
}

export type CatalogCategorizationService = {
  getStatus(scope: { tenantId: string }): Promise<CatalogCategorizationStatus>
}

export type CatalogCategorizationServiceDeps = {
  configService: ModuleConfigService
  /** Resolved soft-optionally from DI; `null` when `ai-assistant` is not installed. */
  decisionModelPort: CatalogDecisionModelPort | null
}

export function createCatalogCategorizationService(
  deps: CatalogCategorizationServiceDeps,
): CatalogCategorizationService {
  const getStatus = async (scope: { tenantId: string }): Promise<CatalogCategorizationStatus> => {
    const settings = await readAiCategorizationSettings(deps.configService, scope)
    if (!deps.decisionModelPort) {
      return {
        available: false,
        reason: 'not_installed',
        enabled: settings.enabled,
        effective: false,
        settings,
      }
    }
    const availability = deps.decisionModelPort.getAvailability({ moduleId: CATALOG_AI_CATEGORIZATION_MODULE_ID })
    return {
      available: availability.available,
      reason: availability.reason,
      enabled: settings.enabled,
      effective: availability.available && settings.enabled,
      settings,
    }
  }

  return { getStatus }
}
