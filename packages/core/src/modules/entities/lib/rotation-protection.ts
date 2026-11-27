import type { RotationProtectionContext, RotationProtectionService, RotationKeyProviders } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const UNPROTECTED_ROTATION_ACKNOWLEDGMENT = 'acknowledge-unprotected-key-rotation'

/** Existing progress-event schema, also used for Core-only rotation notices. */
export function rotationNotice(message: string, phase = 'warning', write: (message: string) => void = message => console.warn(message)): void {
  write(process.env.OM_ROTATION_PROGRESS === 'json'
    ? JSON.stringify({ schemaVersion: 1, type: 'phase.changed', runId: 'rotation', phase: `rotation.${phase}`, entity: message.replace(/^\s*⚠\uFE0F?\s*/u, ''), rowsDone: '0', rowsTotal: '0', rowsTotalExact: false, bytesDone: '0', chunksDone: 0, at: new Date().toISOString() })
    : message)
}

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
  const acknowledged = acknowledgment === true || acknowledgment === 'true'
  const title = acknowledged
    ? translate('entities.rotation.unprotectedAcknowledged', 'Unprotected key rotation: risk acknowledged')
    : translate('entities.rotation.unprotectedRefused', 'Key rotation refused before mutation')
  const color = process.stderr.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb'
  if (process.env.OM_ROTATION_PROGRESS === 'json') {
    rotationNotice(`ERROR: ${title}. ${message}`, 'unprotected', value => console.error(value))
  } else {
    // Keep the whole blocking card in one write. It must remain red after an
    // acknowledgment too: acknowledgment does not supply Enterprise protection.
    const width = Math.max(20, Math.min(100, (process.stderr.columns ?? 100) - 4))
    const wrap = (value: string): string[] => {
      const clean = value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*?(?:\u0007|\u001b\\))/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, ' ')
      const lines: string[] = []
      let line = ''
      for (const word of clean.split(/\s+/)) {
        if (line && line.length + word.length + 1 > width) { lines.push(line); line = '' }
        if (word.length > width) {
          if (line) { lines.push(line); line = '' }
          // Preserve copyable flags as complete tokens; terminal soft wrapping
          // must not insert newlines into the acknowledgment option.
          lines.push(word)
        } else line += (line ? ' ' : '') + word
      }
      if (line) lines.push(line)
      return lines
    }
    const divider = (color ? '─' : '-').repeat(width)
    const card = ['', divider, ...wrap(`${color ? '❌ ' : ''}ERROR: ${title}`), '', ...wrap(message), divider, ''].map(line => `   ${line}`).join('\n')
    console.error(color ? `\u001b[31m${card}\u001b[0m` : card)
  }
  if (!acknowledged) {
    throw new Error(translate('entities.rotation.acknowledgmentRequired', 'Key rotation refused. Rerun with --acknowledge-unprotected-key-rotation to explicitly accept unprotected rotation.'))
  }
  await operation()
}
