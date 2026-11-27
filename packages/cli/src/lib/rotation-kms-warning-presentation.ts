import { runWithKmsWarningWriter } from '@open-mercato/shared/lib/encryption/kms-warning-presentation'

/** Establish presentation before app env loading and bootstrap can activate KMS. */
export function runWithRotationKmsWarningPresentation<T>(argv: readonly string[], operation: () => T): T {
  if (argv[2] !== 'entities' || argv[3] !== 'rotate-encryption-key') return operation()
  return runWithKmsWarningWriter(lines => {
    // App env may be loaded inside operation; do not decide from entry-time env.
    if (process.env.OM_ROTATION_PROGRESS !== 'json') return false
    process.stderr.write(JSON.stringify({ schemaVersion: 1, type: 'phase.changed', runId: 'rotation', phase: 'rotation.kms.warning', entity: lines.map(line => line.replace(/^\s*🚨\uFE0F?\s*/u, '')).join('\n'), rowsDone: '0', rowsTotal: '0', rowsTotalExact: false, bytesDone: '0', chunksDone: 0, at: new Date().toISOString() }) + '\n')
  }, operation)
}
