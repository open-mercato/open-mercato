import { createConfiguredRotationProtection } from '../runtime'
import type { RotationCoordinatorOptions, RecoveryArtifact } from '../coordinator'
import type { VerificationResult } from '../verifier'
import type { RotationProtectionContext } from '@open-mercato/shared/lib/encryption/rotationProtection'

let mockRun: (options: RotationCoordinatorOptions) => Promise<void>
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }) }))
jest.mock('../../engine', () => ({ recipientsFromFile: async () => [], identitiesFromFile: async () => [], createBackup: jest.fn(), verifyBackup: jest.fn(), createPostgresSource: jest.fn() }))
jest.mock('../report', () => ({ publishRotationReport: jest.fn(async () => undefined), publishRotationFailureReport: jest.fn(async () => undefined) }))
jest.mock('../coordinator', () => ({ createEnterpriseRotationProtection: (options: RotationCoordinatorOptions) => ({ protect: async () => mockRun(options) }) }))

const environment: NodeJS.ProcessEnv = {
  OM_ENABLE_ENTERPRISE_MODULES: 'true', OM_ENABLE_ENTERPRISE_MODULES_BACKUPS: 'true', OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED: 'true',
  OM_ROTATION_RECIPIENTS_FILE: '/secure/recipients', OM_ROTATION_IDENTITIES_FILE: '/secure/identities', OM_ROTATION_KMS_PROVIDER: 'derived',
  OM_ROTATION_ARTIFACT_ROOT: '/artifacts', OM_ROTATION_TRUST_ROOT: '/trusted', OM_ROTATION_BACKUP_SOURCE_SERVICE: 'source',
  OM_BACKUP_BINARIES_DIR: '/binaries', PGSERVICEFILE: '/secure/service', PGPASSFILE: '/secure/password', TERM: 'dumb',
}
const context = { tenantId: 'tenant', organizationId: null, previousKey: 'not-used', dryRun: false } as RotationProtectionContext
const receipt: VerificationResult = { schemaVersion: 1, runId: 'verification', coordinatorRunId: 'coordinator-run', status: 'passed', expectedRows: '2', comparedRows: '2', expectedFields: '12', comparedFields: '12', expectedBytes: '1251', comparedBytes: '1251', durationMs: 92 }
const recovery: RecoveryArtifact = { artifactPath: '/retained/backup', digest: 'f'.repeat(64), databaseBinding: 'fixture', consistency: 'quiesced', encrypted: true }

afterEach(() => jest.restoreAllMocks())

test('final success is emitted only after report publication AND coordinator durable completion resolve', async () => {
  const writes: string[] = []
  jest.spyOn(process.stderr, 'write').mockImplementation(chunk => { writes.push(String(chunk)); return true })
  mockRun = async options => {
    await options.reportRun?.('coordinator-run')
    options.phase?.('verification'); options.phase?.('finalizing')
    await options.report(receipt, recovery)
    expect(writes.join('')).not.toContain('Persisted data verification passed')
    writes.push('DURABLE_COORDINATOR_PASSED\n')
  }
  await createConfiguredRotationProtection(environment).protect(context, jest.fn())
  const text = writes.join('')
  expect(text.indexOf('Persisted data verification passed')).toBeGreaterThan(text.indexOf('DURABLE_COORDINATOR_PASSED'))
  expect(text).toContain('/trusted/verification.report.json')
  expect(text).toContain('/retained/backup')
})

test('failure after a receipt was published never prints final success', async () => {
  const writes: string[] = []
  jest.spyOn(process.stderr, 'write').mockImplementation(chunk => { writes.push(String(chunk)); return true })
  mockRun = async options => {
    await options.reportRun?.('coordinator-run')
    options.phase?.('finalizing')
    await options.report(receipt, recovery)
    throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
  }
  await expect(createConfiguredRotationProtection(environment).protect(context, jest.fn())).rejects.toThrow('ROTATION_ARTIFACT_INVALID')
  expect(writes.join('')).not.toContain('Persisted data verification passed')
  expect(writes.join('')).toContain('Keep writers stopped')
  expect(writes.join('')).toContain('OM_ROTATION_RESUME_ID=coordinator-run')
})

test('JSON failure paths contain only existing-schema NDJSON, including run and recovery guidance', async () => {
  const writes: string[] = []
  jest.spyOn(process.stderr, 'write').mockImplementation(chunk => { writes.push(String(chunk)); return true })
  mockRun = async options => {
    await options.reportRun?.('coordinator-run')
    options.phase?.('recovery')
    throw new Error('[internal] ROTATION_BACKUP_FAILED')
  }
  await expect(createConfiguredRotationProtection({ ...environment, OM_ROTATION_PROGRESS: 'json' }).protect(context, jest.fn())).rejects.toThrow('ROTATION_BACKUP_FAILED')
  const events = writes.join('').trim().split('\n').map(line => JSON.parse(line))
  expect(events.every(event => event.schemaVersion === 1 && event.type === 'phase.changed')).toBe(true)
  expect(events.some(event => event.phase === 'rotation.failed')).toBe(true)
  expect(writes.join('')).not.toContain('\u001b')
})
