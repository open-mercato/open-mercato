import { createDerivedKeyKmsService } from '@open-mercato/shared/lib/encryption/kms'
import type { RotationProtectionContext } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { pinRotationProviders, type ExplicitKeyProvider } from './keys'
import { createVersionedVaultProvider } from './vault-provider'

export function rotationProviderKinds(environment: NodeJS.ProcessEnv) {
  const sourceKind = (environment.OM_ROTATION_SOURCE_PROVIDER ?? 'derived').trim()
  const targetKind = (environment.OM_ROTATION_TARGET_PROVIDER ?? environment.OM_ROTATION_KMS_PROVIDER)?.trim()
  if (!['derived', 'vault'].includes(sourceKind) || !targetKind || !['derived', 'vault'].includes(targetKind)) throw new Error('[internal] ROTATION_EXPLICIT_PROVIDER_REQUIRED')
  if (environment.OM_ROTATION_TARGET_PROVIDER !== undefined && environment.OM_ROTATION_KMS_PROVIDER !== undefined && environment.OM_ROTATION_TARGET_PROVIDER.trim() !== environment.OM_ROTATION_KMS_PROVIDER.trim()) throw new Error('[internal] ROTATION_PROVIDER_CONFIGURATION_CONFLICT')
  return { sourceKind, targetKind }
}

export async function resolveRotationProviders(context: RotationProtectionContext, tenantIds: string[], environment: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const { sourceKind, targetKind } = rotationProviderKinds(environment)
  const vault = async (role: 'SOURCE' | 'TARGET'): Promise<ExplicitKeyProvider> => {
    const prefix = `OM_ROTATION_${role}_VAULT_`
    const target = role === 'TARGET'
    const select = (suffix: string, legacy?: string, fallback?: string) => {
      const value = environment[prefix + suffix] ?? (target && legacy ? environment[legacy] : undefined) ?? fallback
      if (!value?.trim()) throw new Error(`[internal] ROTATION_CONFIGURATION_REQUIRED:${prefix}${suffix}`)
      return value.trim()
    }
    return createVersionedVaultProvider(tenantIds, {
      address: select('ADDR', 'VAULT_ADDR'), token: select('TOKEN', 'VAULT_TOKEN'),
      keyPath: select('KV_PATH', 'VAULT_KV_PATH', target ? 'secret/data' : undefined),
      versionsFile: select('VERSIONS_FILE'), target, signal,
    })
  }
  let source: ExplicitKeyProvider
  if (sourceKind === 'derived') {
    if (!context.previousKey) throw new Error('[internal] ROTATION_SOURCE_KEY_REQUIRED')
    source = { identity: 'derived:previous-root', service: createDerivedKeyKmsService(context.previousKey) }
  } else {
    if (context.previousKey) throw new Error('[internal] ROTATION_SOURCE_CONFIGURATION_CONFLICT')
    source = await vault('SOURCE')
  }
  let target: ExplicitKeyProvider
  if (targetKind === 'vault') target = await vault('TARGET')
  else {
    const root = (environment.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? environment.TENANT_DATA_ENCRYPTION_KEY ?? '').trim().replace(/(?:^['"]|['"]$)/g, '')
    if (!root) throw new Error('[internal] ROTATION_TARGET_KEY_REQUIRED')
    target = { identity: 'derived:configured-root', service: createDerivedKeyKmsService(root) }
  }
  return { ...await pinRotationProviders(tenantIds, source, target, signal), signal }
}
