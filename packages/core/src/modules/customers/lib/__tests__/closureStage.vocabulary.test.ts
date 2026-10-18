import type { EntityManager } from '@mikro-orm/postgresql'
import { loadClosurePipelineStageSnapshot, normalizePipelineStageLabel } from '../closureStage'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))

it('preserves localized stage labels and selects the actual terminal stage', async () => {
  jest.mocked(findWithDecryption).mockResolvedValue([
    { id: 'open-stage', pipelineId: 'pipeline', label: '진행', order: 0 },
    { id: 'lost-stage', pipelineId: 'pipeline', label: '거절', order: 1 },
    { id: 'won-stage', pipelineId: 'pipeline', label: '승인', order: 2 },
  ] as never)
  expect(normalizePipelineStageLabel(' 승인 ')).toBe('승인')
  const stage = await loadClosurePipelineStageSnapshot({} as EntityManager, {
    tenantId: 'tenant', organizationId: 'organization', pipelineId: 'pipeline', closureOutcome: 'won',
    vocabulary: { won: ['승인'], lost: ['거절'], closed: ['종료'] },
  })
  expect(stage?.id).toBe('won-stage')
})

it('does not treat an empty normalized alias as any punctuation-only stage', async () => {
  jest.mocked(findWithDecryption).mockResolvedValue([
    { id: 'open-stage', pipelineId: 'pipeline', label: '---', order: 0 },
  ] as never)
  const stage = await loadClosurePipelineStageSnapshot({} as EntityManager, {
    tenantId: 'tenant', organizationId: 'organization', pipelineId: 'pipeline', closureOutcome: 'won',
    vocabulary: { won: ['!!!'], lost: ['declined'], closed: ['finished'] },
  })
  expect(stage).toBeNull()
})
