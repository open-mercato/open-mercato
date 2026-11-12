import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createPostgresSource, createPostgresTarget } from '../postgres'
import { createBackup } from '../create'
import { verifyBackup, readBackup } from '../verify'
import { restoreBackup } from '../restore'
import { exerciseBackup } from '../exercise'
import { preflightBackup } from '../preflight'
import { getBackupStatus } from '../status'
import { recipientsFromFile, identitiesFromFile } from '../crypto'
import { progressRenderer } from '../progress'
import { BackupError } from '../errors'
import { readBoundedFile } from '../artifacts'
import { backupTranslation } from '../locale'
import type { NativeOptions } from '../types'

export async function runBackupCli(argv: string[], io: { stdout: (text: string) => void; stderr: (text: string) => void; appWrapper?: boolean; labels?: Record<string, string> } = { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }): Promise<number> {
  let json = false
  const abort = new AbortController()
  const onInterrupt = () => abort.abort('SIGINT')
  const onTerminate = () => abort.abort('SIGTERM')
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  let timeout: NodeJS.Timeout | undefined
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      json: { type: 'boolean' }, help: { type: 'boolean' }, 'source-service': { type: 'string' }, 'target-service': { type: 'string' },
      output: { type: 'string' }, workspace: { type: 'string' }, artifact: { type: 'string' }, resume: { type: 'string' },
      'trusted-manifest-sha256': { type: 'string' }, 'confirm-target': { type: 'string' }, 'identity-file': { type: 'string' }, 'recipients-file': { type: 'string' },
      'no-encryption': { type: 'boolean' }, 'confirm-unencrypted': { type: 'boolean' }, quiesced: { type: 'boolean' },
      jobs: { type: 'string' }, 'chunk-size-bytes': { type: 'string' }, 'max-output-bytes': { type: 'string' }, 'max-staging-bytes': { type: 'string' },
      'deadline-seconds': { type: 'string' }, 'take-over-lock': { type: 'string' }, 'verify-mode': { type: 'string' },
      'checks-file': { type: 'string' }, report: { type: 'string' }, progress: { type: 'string' }, 'binaries-dir': { type: 'string' }, 'labels-file': { type: 'string' },
    } })
    const values = parsed.values
    json = Boolean(values.json)
    const command = parsed.positionals[0] ?? 'help'
    if (values.help || command === 'help') {
      io.stdout(backupTranslation('backups.cli.help') + '\n')
      return 0
    }
    if (io.appWrapper && json) throw new BackupError('BACKUP_USE_STANDALONE_FOR_JSON', 2)
    if (process.env.OM_ENABLE_ENTERPRISE_MODULES !== 'true' || process.env.OM_ENABLE_ENTERPRISE_MODULES_BACKUPS !== 'true' || process.env.OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED !== 'true') throw new BackupError('BACKUP_ENTERPRISE_RIGHTS_REQUIRED', 3)
    const required = (key: keyof typeof values) => { const value = values[key]; if (typeof value !== 'string' || !value) throw new BackupError('BACKUP_REQUIRED_OPTION', 2); return value }
    const number = (key: keyof typeof values, fallback: number) => { const value = values[key]; if (value === undefined) return fallback; if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BackupError('BACKUP_INVALID_NUMBER', 2); const n = Number(value); if (!Number.isSafeInteger(n)) throw new BackupError('BACKUP_INVALID_NUMBER', 2); return n }
    const jobs = number('jobs', 2)
    const deadline = number('deadline-seconds', 21600)
    if (jobs < 1 || jobs > 8 || deadline < 1 || deadline > 86400) throw new BackupError('BACKUP_INVALID_RESOURCE_OPTION', 2)
    timeout = setTimeout(() => abort.abort('deadline'), deadline * 1000); timeout.unref()
    const native: NativeOptions = { sourceService: typeof values['source-service'] === 'string' ? values['source-service'] : undefined, targetService: typeof values['target-service'] === 'string' ? values['target-service'] : undefined, binariesDir: typeof values['binaries-dir'] === 'string' ? values['binaries-dir'] : process.env.OM_BACKUP_BINARIES_DIR ?? '', serviceFile: process.env.PGSERVICEFILE ?? '', passwordFile: process.env.PGPASSFILE ?? '', jobs, signal: abort.signal, deadlineSeconds: deadline, maxStagingBytes: number('max-staging-bytes', 1024 * 1024 * 1024) }
    const progressMode = values.progress ?? (process.stderr.isTTY ? 'tty' : 'plain')
    if (!['tty', 'plain', 'json', 'verbose', 'none'].includes(String(progressMode))) throw new BackupError('BACKUP_INVALID_PROGRESS', 2)
    const progress = progressRenderer(progressMode as 'tty' | 'plain' | 'json' | 'verbose' | 'none', { write: (text) => { io.stderr(String(text)); return true } })
    const artifact = typeof values.artifact === 'string' ? values.artifact : parsed.positionals[1]
    const identities = typeof values['identity-file'] === 'string' ? await identitiesFromFile(values['identity-file']) : []
    let result: unknown
    if (command === 'status') {
      if (!artifact) throw new BackupError('BACKUP_REQUIRED_ARTIFACT', 2)
      result = await getBackupStatus(artifact)
    } else if (command === 'verify') {
      if (!artifact) throw new BackupError('BACKUP_REQUIRED_ARTIFACT', 2)
      const verified = await verifyBackup({ artifact, trustedManifestSha256: required('trusted-manifest-sha256'), identities, signal: abort.signal, progress })
      result = { backupId: verified.manifest.backupId, consistency: verified.index.consistency }
    } else if (command === 'preflight') {
      if (native.targetService && artifact) {
        const target = createPostgresTarget(native)
        try {
          const backup = await readBackup({ artifact, trustedManifestSha256: required('trusted-manifest-sha256'), identities })
          result = { confirmationChallenge: await target.challenge({ backupId: backup.manifest.backupId, manifestSha256: required('trusted-manifest-sha256'), sourceIdentity: backup.index.identity }), targetIdentity: await target.identity() }
        } finally { await target.close() }
      } else result = await preflightBackup(createPostgresSource(native))
    } else if (command === 'create') {
      const recipientsFile = typeof values['recipients-file'] === 'string' ? values['recipients-file'] : process.env.OM_BACKUP_RECIPIENTS_FILE
      const recipients = recipientsFile ? await recipientsFromFile(recipientsFile) : []
      const labels = typeof values['labels-file'] === 'string' ? JSON.parse((await readBoundedFile(values['labels-file'], 64 * 1024 * 1024)).toString()) as Record<string, string> : io.labels
      if (labels && (Object.keys(labels).length > 100000 || Object.values(labels).some((value) => typeof value !== 'string' || value.length > 4096))) throw new BackupError('BACKUP_INVALID_LABELS', 2)
      result = await createBackup({ source: createPostgresSource(native), output: required('output'), workspace: required('workspace'), recipients, labels, noEncryption: Boolean(values['no-encryption']), confirmUnencrypted: Boolean(values['confirm-unencrypted']), requireEncryption: process.env.OM_BACKUP_REQUIRE_ENCRYPTION === 'true', chunkSizeBytes: number('chunk-size-bytes', 64 * 1024 * 1024), maxOutputBytes: values['max-output-bytes'] === undefined ? undefined : number('max-output-bytes', 0), resume: typeof values.resume === 'string' ? values.resume : undefined, quiesced: Boolean(values.quiesced), identities, takeOverLock: typeof values['take-over-lock'] === 'string' ? values['take-over-lock'] : undefined, progress, signal: abort.signal })
    } else if (command === 'restore' || command === 'exercise') {
      if (!artifact) throw new BackupError('BACKUP_REQUIRED_ARTIFACT', 2)
      const target = createPostgresTarget(native)
      const shared = { artifact, trustedManifestSha256: required('trusted-manifest-sha256'), identities, target, workspace: required('workspace'), confirmation: required('confirm-target'), resume: typeof values.resume === 'string' ? values.resume : undefined, verifyMode: values['verify-mode'] === 'streaming' ? 'streaming' as const : 'full' as const, maxStagingBytes: number('max-staging-bytes', 1024 * 1024 * 1024), reportPath: typeof values.report === 'string' ? values.report : undefined, signal: abort.signal, progress }
      result = command === 'exercise' ? await exerciseBackup({ ...shared, checksFile: required('checks-file') }) : await restoreBackup(shared)
    } else throw new BackupError('BACKUP_UNKNOWN_COMMAND', 2)
    io.stdout(JSON.stringify({ schemaVersion: 1, command, status: 'completed', warnings: [], ...result as object }) + '\n')
    return 0
  } catch (error) {
    const failure = abort.signal.aborted ? new BackupError(abort.signal.reason === 'deadline' ? 'BACKUP_DEADLINE' : 'BACKUP_INTERRUPTED', abort.signal.reason === 'SIGTERM' ? 143 : abort.signal.reason === 'deadline' ? 5 : 130, true) : error instanceof BackupError ? error : new BackupError('BACKUP_INVALID_INPUT_OR_FAILURE', 1)
    const output = { schemaVersion: 1, status: [130, 143].includes(failure.exitCode) ? 'interrupted' : failure.resumable ? 'resumable' : failure.exitCode === 2 || failure.exitCode === 3 ? 'refused' : 'failed', error: { code: failure.code, messageKey: 'backups.cli.error' }, warnings: [], ...failure.context }
    if (json) io.stdout(JSON.stringify(output) + '\n')
    else io.stderr(`${backupTranslation('backups.cli.error')} ${failure.code}\n${failure.context.resumeCommand ? failure.context.resumeCommand + '\n' : ''}`)
    return failure.exitCode
  } finally {
    if (timeout) clearTimeout(timeout)
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
  }
}
