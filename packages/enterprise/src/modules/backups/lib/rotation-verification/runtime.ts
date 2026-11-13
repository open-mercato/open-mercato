import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RotationProtectionContext, RotationProtectionService } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { createBackup, verifyBackup, createPostgresSource, recipientsFromFile, identitiesFromFile } from '../engine'
import { createRotationPresentation } from './presentation'
import type { VerificationResult } from './verifier'
import { createRotationArtifactCipher } from './age'
import { createEnterpriseRotationProtection } from './coordinator'
import { resolveRotationProviders, rotationProviderKinds } from './providers'
import { resolveRecoveryConfiguration, requireRecoveryDirectories, requireRecoveryCustodyFile, RecoveryConfigurationError } from '../../../../lib/recovery-configuration'
import { publishRotationReport, publishRotationFailureReport } from './report'
import { createPostgresRotationDataset, assertPostgresRotationAdmission } from './postgres-dataset'

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`[internal] ROTATION_CONFIGURATION_REQUIRED:${name}`)
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
      const presentation = createRotationPresentation(context, translate, environment)
      if (!hasCommercialRotationRights(environment)) {
        const message = translate('backups.rotation.entitlementRequired', 'Commercial rotation protection rights and module capabilities must be available.')
        presentation.failed(message)
        throw new Error(message)
      }
      let completed: { result: VerificationResult; report: string; backup: string } | undefined
      const controller = new AbortController()
      const deadlineSeconds = Number(environment.OM_ROTATION_DEADLINE_SECONDS ?? 21600)
      if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < 1 || deadlineSeconds > 86400) {
        presentation.failed('[internal] ROTATION_DEADLINE_INVALID')
        throw new Error('[internal] ROTATION_DEADLINE_INVALID')
      }
      const cancel = () => {
        if (controller.signal.aborted) return
        controller.abort(new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE'))
        void context.entityManager.getConnection().close(true).catch(() => undefined)
      }
      const deadline = setTimeout(cancel, deadlineSeconds * 1000); deadline.unref()
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
      try {
        const kinds = rotationProviderKinds(environment)
        const configuration = await resolveRecoveryConfiguration({ env: environment, signal: controller.signal, overrides: {
          backupOutput: environment.OM_ROTATION_BACKUP_OUTPUT, backupWorkspace: environment.OM_ROTATION_BACKUP_WORKSPACE,
          rotationArtifacts: environment.OM_ROTATION_ARTIFACT_ROOT, rotationTrust: environment.OM_ROTATION_TRUST_ROOT,
          recipientsFile: environment.OM_ROTATION_RECIPIENTS_FILE, identityFile: environment.OM_ROTATION_IDENTITIES_FILE,
        } })
        requireRecoveryDirectories(configuration, ['backupOutput', 'backupWorkspace', 'rotationArtifacts', 'rotationTrust'])
        for (const field of ['recipientsFile', 'identityFile', 'serviceFile', 'passwordFile'] as const) requireRecoveryCustodyFile(configuration, field)
        if (!configuration.binaries.directory) throw new Error('[internal] ROTATION_POSTGRES_CLIENTS_REQUIRED')
        const providerEnvironment = { ...environment }
        for (const [role, kind] of [['SOURCE', kinds.sourceKind], ['TARGET', kinds.targetKind]] as const) {
          const name = `OM_ROTATION_${role}_VAULT_VERSIONS_FILE`
          if (kind === 'vault' && providerEnvironment[name] === undefined) {
            requireRecoveryDirectories(configuration, ['custody'])
            providerEnvironment[name] = join(configuration.paths.custody, `rotation-${role.toLowerCase()}-vault-versions.json`)
          }
        }
        const recipients = await recipientsFromFile(configuration.paths.recipientsFile)
        const identities = await identitiesFromFile(configuration.paths.identityFile)
        const native = {
          sourceService: required(environment, 'OM_ROTATION_BACKUP_SOURCE_SERVICE'),
          binariesDir: configuration.binaries.directory,
          serviceFile: configuration.paths.serviceFile, passwordFile: configuration.paths.passwordFile,
          jobs: 1, signal: controller.signal,
        }
        const providers = async (input: RotationProtectionContext) => {
          await assertPostgresRotationAdmission(input, controller.signal)
          const rows: unknown = input.tenantId ? [{ tenant_id: input.tenantId }] : await input.entityManager.execute('SELECT tenant_id::text AS tenant_id FROM (SELECT tenant_id FROM encryption_maps WHERE tenant_id IS NOT NULL UNION SELECT tenant_id FROM custom_entities_storage WHERE tenant_id IS NOT NULL) selected ORDER BY tenant_id LIMIT 10001', [], { signal: controller.signal, inflightQueryAbortStrategy: 'cancel query' })
          if (!Array.isArray(rows) || rows.length > 10000 || rows.some((entry: unknown) => !entry || typeof entry !== 'object' || typeof (entry as { tenant_id?: unknown }).tenant_id !== 'string')) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
          const tenantIds = rows.map((entry: { tenant_id: string }) => entry.tenant_id)
          return resolveRotationProviders(input, tenantIds, providerEnvironment, controller.signal)
        }
        let runId = 'rotation'
        const progress = presentation.progress
        let providerBinding: string | undefined
        let baseDataset: Awaited<ReturnType<typeof createPostgresRotationDataset>> | undefined
        const coordinator = createEnterpriseRotationProtection({
          artifactRoot: configuration.paths.rotationArtifacts,
          trustRoot: configuration.paths.rotationTrust,
          resumeId: environment.OM_ROTATION_RESUME_ID || undefined,
          signal: controller.signal,
          phase: phase => presentation.phase(phase),
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
              const backup = await createBackup({ source: createPostgresSource(native), output: configuration.paths.backupOutput, workspace: configuration.paths.backupWorkspace, recipients, requireEncryption: true, quiesced: true, signal: controller.signal, progress })
              if (backup.consistency !== 'quiesced' || backup.sourceIdentityDigest !== databaseBinding) throw new Error('[internal] ROTATION_BACKUP_DATABASE_MISMATCH')
              return { artifactPath: backup.artifactPath, digest: backup.manifestSha256, databaseBinding, consistency: 'quiesced', encrypted: true }
            },
            async verify(artifact) {
              const verified = await verifyBackup({ artifact: artifact.artifactPath, trustedManifestSha256: artifact.digest, identities, signal: controller.signal, binariesDir: native.binariesDir, workspace: configuration.paths.backupWorkspace })
              if (verified.manifest.encryption.mode !== 'age-v1' || verified.manifest.consistency.mode !== 'quiesced' || createHash('sha256').update(JSON.stringify(verified.index.identity)).digest('hex') !== artifact.databaseBinding) throw new Error('[internal] ROTATION_BACKUP_DATABASE_MISMATCH')
            },
          },
          async cipher() { return createRotationArtifactCipher(recipients, identities) },
          async reportRun(id) { runId = id; presentation.prepared(id) },
          async reportFailure(code, recovery, coordinatorRunId, status, details) {
            await publishRotationFailureReport(join(configuration.paths.rotationTrust, `${coordinatorRunId}.failure.${randomUUID()}.json`), code, recovery, coordinatorRunId, status, details)
          },
          async report(result, recovery) {
            const reportPath = join(configuration.paths.rotationTrust, `${result.runId}.report.json`)
            await publishRotationReport(reportPath, result, recovery)
            completed = { result, report: reportPath, backup: recovery.artifactPath }
          },
        })
        await coordinator.protect(context, async pinned => {
          progress.suspend()
          await operation(pinned)
        })
        if (completed) presentation.completed(completed.result, completed.report, completed.backup)
      } catch (error) {
        presentation.failed(translate('backups.rotation.failed', 'Protected key rotation did not complete. Keep writers stopped, retain all previous keys and recovery artifacts, and inspect the trusted run record before resuming.'))
        if (error instanceof RecoveryConfigurationError) throw new Error(`[internal] ${error.code}:${error.field.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`)
        const code = error instanceof Error && /^\[internal\] [A-Z][A-Z0-9_]*(?::[A-Z][A-Z0-9_]*)?$/.test(error.message) ? error.message : '[internal] ROTATION_VERIFICATION_FAILED'
        throw new Error(code)
      } finally { clearTimeout(deadline); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
    },
  }
}
