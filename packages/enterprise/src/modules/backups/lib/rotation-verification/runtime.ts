import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createDerivedKeyKmsService, HashicorpVaultKmsService } from '@open-mercato/shared/lib/encryption/kms'
import type { RotationProtectionContext, RotationProtectionService } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { createBackup, verifyBackup, createPostgresSource, recipientsFromFile, identitiesFromFile } from '../engine'
import { progressRenderer } from '../engine/progress'
import { createRotationArtifactCipher } from './age'
import { createEnterpriseRotationProtection } from './coordinator'
import { pinRotationProviders } from './keys'
import { publishRotationReport } from './report'
import { createPostgresRotationDataset } from './postgres-dataset'

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`[internal] ROTATION_CONFIGURATION_REQUIRED:${name}`)
  return value
}
function path(environment: NodeJS.ProcessEnv, name: string): string {
  const value = required(environment, name)
  if (!isAbsolute(value)) throw new Error(`[internal] ROTATION_ABSOLUTE_PATH_REQUIRED:${name}`)
  return value
}
export function hasCommercialRotationRights(environment: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanToken(environment.OM_ENABLE_ENTERPRISE_MODULES) === true
    && parseBooleanToken(environment.OM_ENABLE_ENTERPRISE_MODULES_BACKUPS) === true
    && parseBooleanToken(environment.OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED) === true
}

export function createConfiguredRotationProtection(environment: NodeJS.ProcessEnv = process.env): RotationProtectionService {
  return {
    async protect(context, operation) {
      const { translate } = await resolveTranslations()
      if (!hasCommercialRotationRights(environment)) throw new Error(translate('backups.rotation.entitlementRequired', 'Commercial rotation protection rights and module capabilities must be available.'))
      const controller = new AbortController()
      const deadlineSeconds = Number(environment.OM_ROTATION_DEADLINE_SECONDS ?? 21600)
      if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < 1 || deadlineSeconds > 86400) throw new Error('[internal] ROTATION_DEADLINE_INVALID')
      const cancel = () => {
        if (controller.signal.aborted) return
        controller.abort(new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE'))
        void context.entityManager.getConnection().close(true).catch(() => undefined)
      }
      const deadline = setTimeout(cancel, deadlineSeconds * 1000); deadline.unref()
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
      try {
        const recipients = await recipientsFromFile(path(environment, 'OM_ROTATION_RECIPIENTS_FILE'))
        const identities = await identitiesFromFile(path(environment, 'OM_ROTATION_IDENTITIES_FILE'))
        const explicitProvider = required(environment, 'OM_ROTATION_KMS_PROVIDER')
        if (explicitProvider !== 'derived' && explicitProvider !== 'vault') throw new Error('[internal] ROTATION_EXPLICIT_PROVIDER_REQUIRED')
        const native = {
          sourceService: required(environment, 'OM_ROTATION_BACKUP_SOURCE_SERVICE'),
          binariesDir: path(environment, 'OM_BACKUP_BINARIES_DIR'),
          serviceFile: path(environment, 'PGSERVICEFILE'), passwordFile: path(environment, 'PGPASSFILE'),
          jobs: 1, signal: controller.signal,
        }
        const providers = async (input: RotationProtectionContext) => {
          if (!input.previousKey) throw new Error('[internal] ROTATION_SOURCE_KEY_REQUIRED')
          const connection = input.entityManager.getConnection()
          const rows: unknown = input.tenantId ? [{ tenant_id: input.tenantId }] : await input.entityManager.execute('SELECT tenant_id::text AS tenant_id FROM (SELECT tenant_id FROM encryption_maps WHERE tenant_id IS NOT NULL UNION SELECT tenant_id FROM custom_entities_storage WHERE tenant_id IS NOT NULL) selected ORDER BY tenant_id LIMIT 10001', [], { signal: controller.signal, inflightQueryAbortStrategy: 'cancel query' })
          if (!Array.isArray(rows) || rows.length > 10000 || rows.some((entry: unknown) => !entry || typeof entry !== 'object' || typeof (entry as { tenant_id?: unknown }).tenant_id !== 'string')) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
          const tenantIds = rows.map((entry: { tenant_id: string }) => entry.tenant_id)
          const target = explicitProvider === 'vault'
            ? new HashicorpVaultKmsService({ ttlMs: 0, vaultAddr: required(environment, 'VAULT_ADDR'), vaultToken: required(environment, 'VAULT_TOKEN'), mountPath: environment.VAULT_KV_PATH || 'secret/data' })
            : createDerivedKeyKmsService((environment.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? environment.TENANT_DATA_ENCRYPTION_KEY ?? '').trim().replace(/(?:^['"]|['"]$)/g, ''))
          if (explicitProvider === 'derived' && !environment.TENANT_DATA_ENCRYPTION_FALLBACK_KEY?.trim() && !environment.TENANT_DATA_ENCRYPTION_KEY?.trim()) throw new Error('[internal] ROTATION_EXPLICIT_PROVIDER_REQUIRED')
          const pinned = await pinRotationProviders(tenantIds,
            { identity: 'derived:previous-root', service: createDerivedKeyKmsService(input.previousKey) },
            { identity: explicitProvider === 'vault' ? `vault:${environment.VAULT_ADDR ?? ''}:${environment.VAULT_KV_PATH ?? 'secret/data'}` : 'derived:configured-root', service: target }, controller.signal)
          return { ...pinned, signal: controller.signal }
        }
        let runId = 'rotation'
        const progress = progressRenderer(environment.OM_ROTATION_PROGRESS === 'json' ? 'json' : environment.OM_ROTATION_PROGRESS === 'none' ? 'none' : process.stderr.isTTY ? 'tty' : 'plain')
        let providerBinding: string | undefined
        let baseDataset: Awaited<ReturnType<typeof createPostgresRotationDataset>> | undefined
        const coordinator = createEnterpriseRotationProtection({
          artifactRoot: path(environment, 'OM_ROTATION_ARTIFACT_ROOT'),
          trustRoot: path(environment, 'OM_ROTATION_TRUST_ROOT'),
          resumeId: environment.OM_ROTATION_RESUME_ID || undefined,
          signal: controller.signal,
          async assertEntitlement() { if (!hasCommercialRotationRights(environment)) throw new Error('[internal] ROTATION_ENTITLEMENT_UNAVAILABLE') },
          async providers(input) { const pinned = await providers(input); providerBinding = pinned.provider; return pinned },
          async dataset(input, pinned, backupDigest, intents) {
            if (!providerBinding) throw new Error('[internal] ROTATION_EXPLICIT_PROVIDER_REQUIRED')
            baseDataset ??= await createPostgresRotationDataset({ context: input, providers: pinned, backupDigest, provider: providerBinding, intents, progress, runId })
            const dataset = baseDataset
            return { ...dataset, async binding() { return { ...await dataset.binding(), backupDigest } } }
          },
          recovery: {
            async create(_input, databaseBinding) {
              console.error(translate('backups.rotation.preparingRecovery', 'Preparing encrypted recovery backup before key rotation.'))
              const backup = await createBackup({ source: createPostgresSource(native), output: path(environment, 'OM_ROTATION_BACKUP_OUTPUT'), workspace: path(environment, 'OM_ROTATION_BACKUP_WORKSPACE'), recipients, requireEncryption: true, quiesced: true, signal: controller.signal, progress })
              if (backup.consistency !== 'quiesced' || backup.sourceIdentityDigest !== databaseBinding) throw new Error('[internal] ROTATION_BACKUP_DATABASE_MISMATCH')
              return { artifactPath: backup.artifactPath, digest: backup.manifestSha256, databaseBinding, consistency: 'quiesced', encrypted: true }
            },
            async verify(artifact) {
              const verified = await verifyBackup({ artifact: artifact.artifactPath, trustedManifestSha256: artifact.digest, identities, signal: controller.signal })
              if (verified.manifest.encryption.mode !== 'age-v1' || verified.manifest.consistency.mode !== 'quiesced' || createHash('sha256').update(JSON.stringify(verified.index.identity)).digest('hex') !== artifact.databaseBinding) throw new Error('[internal] ROTATION_BACKUP_DATABASE_MISMATCH')
            },
          },
          async cipher() { return createRotationArtifactCipher(recipients, identities) },
          async reportRun(id) { runId = id; console.error(`${translate('backups.rotation.runPrepared', 'Protected rotation run; retain this identifier for an explicit resume:')} ${id}`) },
          async report(result, recovery) {
            const reportPath = join(path(environment, 'OM_ROTATION_TRUST_ROOT'), `${result.runId}.report.json`)
            await publishRotationReport(reportPath, result, recovery)
            console.error(translate('backups.rotation.verificationPassed', 'Persisted data verification passed for the declared rotation scope; retain previous keys and the recovery backup.'))
            console.log(JSON.stringify({ ...result, recoveryArtifact: recovery.artifactPath }))
          },
        })
        await coordinator.protect(context, async pinned => {
          console.error(translate('backups.rotation.rotating', 'Rotating encrypted data with protected recovery.'))
          await operation(pinned)
          console.error(translate('backups.rotation.verifying', 'Verifying persisted data after key rotation.'))
        })
      } catch (error) {
        console.error(translate('backups.rotation.failed', 'Protected key rotation did not complete. Keep writers stopped, retain all previous keys and recovery artifacts, and inspect the trusted run record before resuming.'))
        const code = error instanceof Error && /^\[internal\] [A-Z][A-Z0-9_]*(?::[A-Z][A-Z0-9_]*)?$/.test(error.message) ? error.message : '[internal] ROTATION_VERIFICATION_FAILED'
        throw new Error(code)
      } finally { clearTimeout(deadline); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
    },
  }
}
