import type { RotationProtectionContext, RotationProtectionService, RotationKeyProviders } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const UNPROTECTED_ROTATION_ACKNOWLEDGMENT = 'acknowledge-unprotected-key-rotation'

export async function protectKeyRotation(
  context: RotationProtectionContext,
  acknowledgment: string | boolean | undefined,
  service: RotationProtectionService | undefined,
  operation: (providers?: RotationKeyProviders) => Promise<void>,
): Promise<void> {
  if (context.dryRun) {
    const { translate } = await resolveTranslations()
    console.log(service && typeof service.protect === 'function'
      ? translate('entities.rotation.previewProtected', 'Dry run: a rotation protection service is registered; its recovery prerequisites will be verified before a mutating run.')
      : translate('entities.rotation.previewUnprotected', 'Dry run: Enterprise rotation protection is unavailable. No risk acknowledgment is required for this read-only preview.'))
    return operation()
  }
  if (service) {
    if (typeof service.protect !== 'function') throw new Error('[internal] Rotation protection service is invalid')
    if (context.entityManager?.isInTransaction?.() || context.entityManager?.getTransactionContext?.()) throw new Error('[internal] Protected key rotation requires committed maintenance writes outside an active transaction')
    return service.protect(context, operation)
  }
  const { translate } = await resolveTranslations()
  const message = translate('entities.rotation.unprotectedWarning', 'Enterprise resumable encrypted backup and post-rotation verification are unavailable. Interrupted or incorrect rotation can make data unrecoverable. Keep a tested independent backup and all previous keys. To accept this risk, rerun the same command with --acknowledge-unprotected-key-rotation.')
  const color = process.stderr.isTTY && !process.env.NO_COLOR
  console.error(color ? `\u001b[31mERROR: ${message}\u001b[0m` : `ERROR: ${message}`)
  if (acknowledgment !== true && acknowledgment !== 'true') {
    throw new Error(translate('entities.rotation.acknowledgmentRequired', 'Key rotation refused. Rerun with --acknowledge-unprotected-key-rotation to explicitly accept unprotected rotation.'))
  }
  await operation()
}
