export class BackupError extends Error {
  details: { foreignKeyFailures?: { schema: string; table: string; name: string }[] } = {}
  context: { backupId?: string; restoreRunId?: string; partialStateSha256?: string; reportPath?: string; validationFailureCount?: number; failedEntityKeys?: string[]; resumeCommand?: string } = {}
  constructor(public readonly code: string, public readonly exitCode: number, public readonly resumable = false) {
    super(`[internal] ${code}`)
    this.name = 'BackupError'
  }
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BackupError(signal.reason === 'deadline' ? 'BACKUP_DEADLINE' : 'BACKUP_INTERRUPTED', signal.reason === 'SIGTERM' ? 143 : signal.reason === 'deadline' ? 5 : 130, true)
}

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
