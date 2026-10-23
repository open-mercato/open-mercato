import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'
import { claimCompanyMapping, xeroClaimLockKey } from '../lib/contacts/claim'
import { classifyXeroRunError } from '../lib/run-guard'

type MappingRow = { externalId: string; internalEntityId: string }
type LockCall = { em: EntityManager; key: string; options: unknown }

const requestEm = { name: 'request-em' } as unknown as EntityManager
const txEm = { name: 'lock-transaction-em' } as unknown as EntityManager

let mappingRows: MappingRow[] = []
let liveCompanies = new Set<string>()
let lockUnavailable = false
const lockCalls: LockCall[] = []
const boundEms: EntityManager[] = []
const storeCalls: unknown[][] = []

jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/db/advisoryLock')
  return {
    ...actual,
    withAdvisoryXactLock: async (em: EntityManager, key: string, fn: (tx: EntityManager) => Promise<unknown>, options: unknown) => {
      lockCalls.push({ em, key, options })
      if (lockUnavailable) throw new actual.AdvisoryLockUnavailableError('deadline', key)
      return fn(txEm)
    },
  }
})

jest.mock('@open-mercato/core/modules/data_sync/lib/id-mapping', () => ({
  createExternalIdMappingService: (em: EntityManager) => {
    boundEms.push(em)
    return {
      async lookupLocalId(_integrationId: string, _type: string, externalId: string) {
        return mappingRows.find((row) => row.externalId === externalId)?.internalEntityId ?? null
      },
      async lookupExternalId(_integrationId: string, _type: string, localId: string) {
        return mappingRows.find((row) => row.internalEntityId === localId)?.externalId ?? null
      },
      async storeExternalIdMapping(...args: unknown[]) {
        storeCalls.push(args)
        const [, , localId, externalId] = args as [string, string, string, string]
        const existing = mappingRows.find((row) => row.externalId === externalId) ?? mappingRows.find((row) => row.internalEntityId === localId)
        if (existing) {
          existing.externalId = externalId
          existing.internalEntityId = localId
        } else {
          mappingRows.push({ externalId, internalEntityId: localId })
        }
      },
    }
  },
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: async (em: EntityManager, entity: unknown, where: { id: string; kind: string; deletedAt: null }) => {
    if (em !== txEm) throw new Error('[internal] the claim must read on the lock transaction')
    if (entity !== CustomerEntity || where.kind !== 'company' || where.deletedAt !== null) throw new Error('[internal] unexpected lookup')
    return liveCompanies.has(where.id) ? { id: where.id } : null
  },
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const ORG = 'a3b1c2d3-0000-4000-8000-000000000001'
const CONTACT = 'c0000000-0000-4000-8000-000000000001'
const EXTERNAL_ID = `${ORG}:${CONTACT}`
const COMPANY_A = 'e0000000-0000-4000-8000-00000000000a'
const COMPANY_B = 'e0000000-0000-4000-8000-00000000000b'

function claim(candidateEntityId: string, allowDeletedTarget?: boolean) {
  return claimCompanyMapping({ em: requestEm, scope, xeroOrganisationId: ORG, contactId: CONTACT, candidateEntityId, allowDeletedTarget })
}

beforeEach(() => {
  mappingRows = []
  liveCompanies = new Set([COMPANY_A, COMPANY_B])
  lockUnavailable = false
  lockCalls.length = 0
  boundEms.length = 0
  storeCalls.length = 0
})

describe('claimCompanyMapping', () => {
  it('wins a free Contact and Company, storing the mapping on the lock transaction under the organization key', async () => {
    await expect(claim(COMPANY_A)).resolves.toEqual({ outcome: 'won' })

    expect(lockCalls).toEqual([{ em: requestEm, key: `sync_xero_claim:${scope.organizationId}`, options: { maxConcurrentHolders: 4 } }])
    expect(xeroClaimLockKey(scope)).toBe(`sync_xero_claim:${scope.organizationId}`)
    expect(boundEms).toEqual([txEm])
    expect(storeCalls).toEqual([['sync_xero', 'customers.company', COMPANY_A, EXTERNAL_ID, scope]])
    expect(mappingRows).toEqual([{ externalId: EXTERNAL_ID, internalEntityId: COMPANY_A }])
  })

  it('counts a mapping that already names the candidate as won and stores nothing', async () => {
    mappingRows = [{ externalId: EXTERNAL_ID, internalEntityId: COMPANY_A }]

    await expect(claim(COMPANY_A)).resolves.toEqual({ outcome: 'won' })
    expect(storeCalls).toEqual([])
  })

  it('loses to the Company the Contact is already mapped to', async () => {
    mappingRows = [{ externalId: EXTERNAL_ID, internalEntityId: COMPANY_B }]

    await expect(claim(COMPANY_A)).resolves.toEqual({ outcome: 'lost', winnerEntityId: COMPANY_B, winnerDeleted: false })
    expect(storeCalls).toEqual([])
  })

  it('reports a winner deleted in OM, and does not re-point it without allowDeletedTarget', async () => {
    mappingRows = [{ externalId: EXTERNAL_ID, internalEntityId: COMPANY_B }]
    liveCompanies.delete(COMPANY_B)

    await expect(claim(COMPANY_A)).resolves.toEqual({ outcome: 'lost', winnerEntityId: COMPANY_B, winnerDeleted: true })
    expect(storeCalls).toEqual([])
  })

  it('re-points a mapping to a deleted Company with allowDeletedTarget (the invoices self-heal)', async () => {
    mappingRows = [{ externalId: EXTERNAL_ID, internalEntityId: COMPANY_B }]
    liveCompanies.delete(COMPANY_B)

    await expect(claim(COMPANY_A, true)).resolves.toEqual({ outcome: 'won' })
    expect(mappingRows).toEqual([{ externalId: EXTERNAL_ID, internalEntityId: COMPANY_A }])
  })

  it('loses without a winner when the candidate is mapped to another Contact', async () => {
    mappingRows = [{ externalId: `${ORG}:another-contact`, internalEntityId: COMPANY_A }]

    await expect(claim(COMPANY_A)).resolves.toEqual({ outcome: 'lost', winnerEntityId: null })
    expect(storeCalls).toEqual([])
  })

  it('lets an unavailable lock fail the run with xero.claim_lock_unavailable', async () => {
    lockUnavailable = true

    const error = await claim(COMPANY_A).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AdvisoryLockUnavailableError)
    expect(storeCalls).toEqual([])
    const outcome = classifyXeroRunError(error, 'scheduled')
    expect(outcome).toMatchObject({ kind: 'fail', failure: { code: 'xero.claim_lock_unavailable' } })
    expect(outcome?.kind === 'fail' ? outcome.failure.message : '').toMatch(/^xero\.claim_lock_unavailable: /)
  })
})
