import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { resolveApiVersion } from './client'
import { SHOPIFY_INTEGRATION_ID } from './types'

type IntegrationScope = {
  organizationId: string
  tenantId: string
}

export type ShopifyEnvPreset = {
  shopDomain: string
  clientId: string
  clientSecret: string
  apiVersion: string
  force: boolean
}

export type ApplyShopifyPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured' }

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

export function readShopifyEnvPreset(env: NodeJS.ProcessEnv = process.env): ShopifyEnvPreset | null {
  const shopDomain = readEnvValue(env, 'OM_INTEGRATION_SHOPIFY_SHOP_DOMAIN')
  const clientId = readEnvValue(env, 'OM_INTEGRATION_SHOPIFY_CLIENT_ID')
  const clientSecret = readEnvValue(env, 'OM_INTEGRATION_SHOPIFY_CLIENT_SECRET')
  if (!shopDomain || !clientId || !clientSecret) return null
  const force = env.OM_INTEGRATION_SHOPIFY_FORCE === 'true' || env.OM_INTEGRATION_SHOPIFY_FORCE === '1'
  return {
    shopDomain,
    clientId,
    clientSecret,
    apiVersion: resolveApiVersion(readEnvValue(env, 'OM_INTEGRATION_SHOPIFY_API_VERSION')),
    force,
  }
}

export async function applyShopifyEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyShopifyPresetResult> {
  const preset = readShopifyEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No Shopify preset env variables were provided.' }
  }
  const force = params.force ?? preset.force
  const existing = await params.credentialsService.getRaw(SHOPIFY_INTEGRATION_ID, params.scope)
  if (!force && existing) {
    return { status: 'skipped', reason: 'Shopify credentials already exist. Use force to overwrite them.' }
  }
  await params.credentialsService.save(SHOPIFY_INTEGRATION_ID, {
    shopDomain: preset.shopDomain,
    clientId: preset.clientId,
    clientSecret: preset.clientSecret,
    apiVersion: preset.apiVersion,
  }, params.scope)
  await params.integrationStateService.upsert(SHOPIFY_INTEGRATION_ID, { isEnabled: true }, params.scope)
  if (params.integrationLogService) {
    await params.integrationLogService.scoped(SHOPIFY_INTEGRATION_ID, params.scope).info(
      'Shopify integration was preconfigured from environment variables.',
      { shopDomain: preset.shopDomain, apiVersion: preset.apiVersion },
    )
  }
  return { status: 'configured' }
}
