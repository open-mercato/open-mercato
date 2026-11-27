import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { aiCategorizationSettingsSchema, type AiCategorizationSettings } from '../data/validators'
import { AI_CATEGORIZATION_CONFIG_NAME, CATALOG_SETTINGS_MODULE_ID } from './settings'

export const AI_CATEGORIZATION_SETTINGS_DEFAULT: AiCategorizationSettings = aiCategorizationSettingsSchema.parse({})

/**
 * Reads the tenant's AI categorization settings row. A missing row, or one
 * that fails schema validation (e.g. written by an older/newer shape), falls
 * back to the defaults — which means the feature is off.
 */
export async function readAiCategorizationSettings(
  configService: ModuleConfigService,
  scope: { tenantId: string },
): Promise<AiCategorizationSettings> {
  const value = await configService.getValue<unknown>(
    CATALOG_SETTINGS_MODULE_ID,
    AI_CATEGORIZATION_CONFIG_NAME,
    { defaultValue: AI_CATEGORIZATION_SETTINGS_DEFAULT, scope: { tenantId: scope.tenantId } },
  )
  const parsed = aiCategorizationSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : AI_CATEGORIZATION_SETTINGS_DEFAULT
}

export async function writeAiCategorizationSettings(
  configService: ModuleConfigService,
  scope: { tenantId: string },
  settings: AiCategorizationSettings,
): Promise<void> {
  await configService.setValue(
    CATALOG_SETTINGS_MODULE_ID,
    AI_CATEGORIZATION_CONFIG_NAME,
    settings,
    { tenantId: scope.tenantId },
  )
}
