/** @jest-environment node */

import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { transformFeatureToggleListItem } from '../route'

const UPDATED_AT = '2026-06-01T10:00:00.000Z'
const CREATED_AT = '2026-05-01T08:00:00.000Z'

function rawListRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    identifier: 'beta_feature',
    name: 'Beta Feature',
    description: 'A beta feature',
    category: 'experiments',
    type: 'boolean',
    default_value: true,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  }
}

describe('feature_toggles global list optimistic-lock version (issue #3239)', () => {
  it('exposes the version under camelCase updatedAt so the table can read row.updatedAt', () => {
    const item = transformFeatureToggleListItem(rawListRow())
    expect(item.updatedAt).toBe(UPDATED_AT)
    expect(item.createdAt).toBe(CREATED_AT)
  })

  it('does not leak the snake_case keys the table never reads', () => {
    const item = transformFeatureToggleListItem(rawListRow()) as Record<string, unknown>
    expect('updated_at' in item).toBe(false)
    expect('created_at' in item).toBe(false)
  })

  it('produces a non-empty optimistic-lock header for a stale list row delete', () => {
    const item = transformFeatureToggleListItem(rawListRow())
    const header = buildOptimisticLockHeader(item.updatedAt as string)
    expect(header).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  it('regression: reading the old updated_at key would have sent no version token', () => {
    const item = transformFeatureToggleListItem(rawListRow()) as Record<string, unknown>
    const header = buildOptimisticLockHeader(item.updated_at as undefined)
    expect(header).toEqual({})
  })
})
