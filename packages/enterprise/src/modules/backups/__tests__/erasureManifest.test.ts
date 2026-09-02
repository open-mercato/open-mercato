import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ErasureManifestService } from '../lib/erasureManifest'

describe('ErasureManifestService', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'om-erasure-manifest-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('returns only erasures newer than a backup timestamp', async () => {
    const service = new ErasureManifestService(directory)
    await service.append({
      requestId: 'request-before',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      subjectKind: 'auth:user',
      subjectId: 'user-1',
      executedAt: new Date('2026-08-21T09:00:00.000Z'),
    })
    await service.append({
      requestId: 'request-after',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      subjectKind: 'auth:user',
      subjectId: 'user-2',
      dataClassIds: ['auth.users', 'auth.users'],
      executedAt: new Date('2026-08-21T11:00:00.000Z'),
    })

    const result = await service.listAfter(new Date('2026-08-21T10:00:00.000Z'))

    expect(result).toHaveLength(1)
    expect(result[0]?.requestId).toBe('request-after')
    expect(result[0]?.subjectId).toBe('user-2')
    expect(result[0]?.dataClassIds).toEqual(['auth.users'])
  })
})
