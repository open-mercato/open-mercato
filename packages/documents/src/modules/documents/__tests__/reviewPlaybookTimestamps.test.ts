import { readTimestamp, toReviewPlaybookItem, toReviewRuleItem } from '../api/_reviewPlaybooks'
import { reviewPlaybookUpdateSchema, reviewRuleUpdateSchema } from '../data/validators'

const RULE_ID = '6f1d4c1e-6a5b-4a43-9a7e-2f1a0b3c4d5e'
const PLAYBOOK_ID = '0b9e7c2a-3d4f-4e5a-8b6c-7d8e9f0a1b2c'
const RAW_POSTGRES_TIMESTAMP = '2026-11-12 07:51:19.322+00'
const ISO_TIMESTAMP = '2026-11-12T07:51:19.322Z'

describe('review playbook list timestamps', () => {
  it('normalizes raw Postgres timestamps to ISO 8601', () => {
    expect(readTimestamp({ updated_at: RAW_POSTGRES_TIMESTAMP }, 'updated_at')).toBe(ISO_TIMESTAMP)
    expect(readTimestamp({ updated_at: '2026-11-12 07:51:19.322123+02' }, 'updated_at')).toBe('2026-11-12T05:51:19.322Z')
    expect(readTimestamp({ updatedAt: new Date(ISO_TIMESTAMP) }, 'updated_at', 'updatedAt')).toBe(ISO_TIMESTAMP)
    expect(readTimestamp({}, 'updated_at')).toBeNull()
  })

  it('returns rule timestamps that round-trip into an update as expectedUpdatedAt', () => {
    const item = toReviewRuleItem({
      id: RULE_ID,
      playbook_id: PLAYBOOK_ID,
      code: 'R-1',
      title: 'Rule',
      position: 'Position',
      severity: 'blocking',
      created_at: RAW_POSTGRES_TIMESTAMP,
      updated_at: RAW_POSTGRES_TIMESTAMP,
    })
    expect(item.createdAt).toBe(ISO_TIMESTAMP)
    expect(item.updatedAt).toBe(ISO_TIMESTAMP)
    const update = reviewRuleUpdateSchema.safeParse({ id: RULE_ID, title: 'Rule v2', expectedUpdatedAt: item.updatedAt })
    expect(update.success).toBe(true)
  })

  it('returns playbook timestamps that round-trip into an update as expectedUpdatedAt', () => {
    const item = toReviewPlaybookItem({
      id: PLAYBOOK_ID,
      code: 'PB',
      name: 'Playbook',
      created_at: RAW_POSTGRES_TIMESTAMP,
      updated_at: RAW_POSTGRES_TIMESTAMP,
    })
    expect(item.updatedAt).toBe(ISO_TIMESTAMP)
    const update = reviewPlaybookUpdateSchema.safeParse({ id: PLAYBOOK_ID, name: 'Playbook v2', expectedUpdatedAt: item.updatedAt })
    expect(update.success).toBe(true)
  })
})
