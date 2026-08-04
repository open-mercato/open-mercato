import { createHash, randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import type { TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { OnboardingRequest } from '../modules/onboarding/data/entities'
import { OnboardingService } from '../modules/onboarding/lib/service'
import { defaultEncryptionMaps } from '../modules/onboarding/encryption'

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('freshly_hashed_password'),
}))

const LEGACY_EMAIL = 'legacy.signup@example.com'
const SYSTEM_KEY = randomBytes(32).toString('base64')

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function makeLegacyPlaintextRow(): OnboardingRequest {
  return Object.assign(new OnboardingRequest(), {
    id: 'legacy-row',
    email: LEGACY_EMAIL,
    emailHash: null,
    tokenHash: hashToken('legacy-token'),
    status: 'pending',
    firstName: 'Ada',
    lastName: 'Lovelace',
    organizationName: 'Analytical Engines',
    locale: 'en',
    termsAccepted: true,
    marketingConsent: false,
    passwordHash: 'legacy_bcrypt_hash',
    expiresAt: new Date(Date.now() + 86_400_000),
    completedAt: null,
    processingStartedAt: null,
    tenantId: null,
    organizationId: null,
    userId: null,
    lastEmailSentAt: new Date(Date.now() - 60 * 60 * 1000),
    preparationStartedAt: null,
    preparationCompletedAt: null,
    readyEmailSentAt: null,
    createdAt: new Date(Date.now() - 7 * 86_400_000),
    updatedAt: new Date(Date.now() - 7 * 86_400_000),
    deletedAt: null,
  })
}

function matchesCondition(actual: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
    const operators = condition as Record<string, unknown>
    if ('$in' in operators) return (operators.$in as unknown[]).includes(actual)
    if ('$gt' in operators) return (actual as Date) > (operators.$gt as Date)
    if ('$ne' in operators) return actual !== operators.$ne
    return false
  }
  return actual === condition
}

function matchesFilter(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Record<string, unknown>[]).some((branch) => matchesFilter(row, branch))
    return matchesCondition(row[key], condition)
  })
}

/**
 * Minimal filter-evaluating EntityManager stand-in. The point of this suite is that a
 * backfilled row is still *found* by the service's real lookup, so the fake has to
 * actually evaluate the `$or` the service builds rather than record the call.
 */
function makeEm(rows: OnboardingRequest[]) {
  const created: OnboardingRequest[] = []
  return {
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
      rows.find((row) => matchesFilter(row as unknown as Record<string, unknown>, where)) ?? null),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      const row = Object.assign(new OnboardingRequest(), data)
      created.push(row)
      return row
    }),
    persist: jest.fn(() => ({ flush: jest.fn(async () => {}) })),
    flush: jest.fn(async () => {}),
    created,
  } as unknown as EntityManager & { created: OnboardingRequest[]; findOne: jest.Mock; create: jest.Mock }
}

function makeEncryptionService(em: EntityManager) {
  const kms = {
    isHealthy: () => true,
    async getTenantDek(tenantId: string): Promise<TenantDek | null> {
      return { tenantId, key: SYSTEM_KEY, fetchedAt: Date.now() }
    },
    async createTenantDek(tenantId: string): Promise<TenantDek | null> {
      return this.getTenantDek(tenantId)
    },
  }
  return new TenantDataEncryptionService(em, { kms, defaultEncryptionMaps })
}

/**
 * Applies exactly what `mercato entities backfill-system-encryption` applies to one row:
 * the mapped fields go through `encryptEntityPayload` under the system key, and the
 * resulting ciphertext plus lookup hash are written back to the record.
 */
async function backfillRow(service: TenantDataEncryptionService, row: OnboardingRequest): Promise<void> {
  const encrypted = await service.encryptEntityPayload('onboarding:onboarding_request', {
    email: row.email,
    email_hash: row.emailHash ?? null,
    first_name: row.firstName,
    last_name: row.lastName,
    organization_name: row.organizationName,
    password_hash: row.passwordHash ?? null,
  }, null, null)
  row.email = encrypted.email as string
  row.emailHash = encrypted.email_hash as string
  row.firstName = encrypted.first_name as string
  row.lastName = encrypted.last_name as string
  row.organizationName = encrypted.organization_name as string
  row.passwordHash = encrypted.password_hash as string
}

describe('backfilled legacy onboarding request (#3876)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('encrypts every mapped field and populates the lookup hash', async () => {
    const row = makeLegacyPlaintextRow()
    const em = makeEm([row])

    await backfillRow(makeEncryptionService(em), row)

    for (const value of [row.email, row.firstName, row.lastName, row.organizationName, row.passwordHash]) {
      expect(value).toMatch(/^[^:]+:[^:]+:[^:]+:v1$/)
    }
    expect(lookupHashCandidates(LEGACY_EMAIL)).toContain(row.emailHash)
  })

  it('still resolves the row on resubmit instead of creating a duplicate', async () => {
    const row = makeLegacyPlaintextRow()
    const em = makeEm([row])
    await backfillRow(makeEncryptionService(em), row)

    const service = new OnboardingService(em)
    const { request } = await service.createOrUpdateRequest({
      email: LEGACY_EMAIL,
      firstName: 'Ada',
      lastName: 'Lovelace',
      organizationName: 'Analytical Engines',
      password: 'Secret1!',
      confirmPassword: 'Secret1!',
      termsAccepted: true,
      marketingConsent: false,
    } as never)

    expect(request.id).toBe('legacy-row')
    expect(em.created).toHaveLength(0)
    expect(em.create).not.toHaveBeenCalled()
  })

  it('still resolves the row by verification token after the backfill', async () => {
    const row = makeLegacyPlaintextRow()
    const em = makeEm([row])
    await backfillRow(makeEncryptionService(em), row)

    const found = await new OnboardingService(em).findPendingByToken('legacy-token')

    expect(found?.id).toBe('legacy-row')
  })

  it('leaves a row the backfill already processed unchanged on a second pass', async () => {
    const row = makeLegacyPlaintextRow()
    const em = makeEm([row])
    const service = makeEncryptionService(em)

    await backfillRow(service, row)
    const afterFirstPass = { email: row.email, emailHash: row.emailHash, passwordHash: row.passwordHash }
    await backfillRow(service, row)

    expect(row.email).toBe(afterFirstPass.email)
    expect(row.emailHash).toBe(afterFirstPass.emailHash)
    expect(row.passwordHash).toBe(afterFirstPass.passwordHash)
  })

  it('still finds a row that was never backfilled, through the legacy plaintext branch', async () => {
    const row = makeLegacyPlaintextRow()
    const em = makeEm([row])

    const found = await new OnboardingService(em).createOrUpdateRequest({
      email: LEGACY_EMAIL,
      firstName: 'Ada',
      lastName: 'Lovelace',
      organizationName: 'Analytical Engines',
      password: 'Secret1!',
      confirmPassword: 'Secret1!',
      termsAccepted: true,
      marketingConsent: false,
    } as never)

    expect(found.request.id).toBe('legacy-row')
    expect(em.create).not.toHaveBeenCalled()
  })
})
