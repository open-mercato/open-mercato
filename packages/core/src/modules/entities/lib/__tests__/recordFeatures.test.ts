/** @jest-environment node */

import {
  coarseRecordFeature,
  deriveCustomEntityRecordFeature,
  synthesizedRecordFeatures,
  RECORDS_VIEW_FEATURE,
  RECORDS_MANAGE_FEATURE,
} from '@open-mercato/core/modules/entities/lib/recordFeatures'
import { matchFeature, hasAllFeatures } from '@open-mercato/shared/security/features'

describe('recordFeatures deriver', () => {
  test('coarse features are the entity-agnostic route features', () => {
    expect(coarseRecordFeature('view')).toBe('entities.records.view')
    expect(coarseRecordFeature('manage')).toBe('entities.records.manage')
  })

  test('derives a stable per-entity feature keyed on entityId', () => {
    expect(deriveCustomEntityRecordFeature('hr:salaries', 'view')).toBe('entities.records.hr:salaries.view')
    expect(deriveCustomEntityRecordFeature('hr:salaries', 'manage')).toBe('entities.records.hr:salaries.manage')
    expect(deriveCustomEntityRecordFeature('user:vendors', 'view')).toBe('entities.records.user:vendors.view')
  })

  test('coarse grant does NOT satisfy a per-entity feature (compartmentalization)', () => {
    const required = deriveCustomEntityRecordFeature('hr:salaries', 'view')
    expect(matchFeature(required, RECORDS_VIEW_FEATURE)).toBe(false)
    expect(hasAllFeatures([RECORDS_VIEW_FEATURE], [required])).toBe(false)
  })

  test('the exact per-entity grant satisfies the requirement', () => {
    const required = deriveCustomEntityRecordFeature('hr:salaries', 'manage')
    expect(hasAllFeatures([required], [required])).toBe(true)
  })

  test('records and module wildcards satisfy per-entity features; global too', () => {
    const required = deriveCustomEntityRecordFeature('hr:salaries', 'view')
    expect(matchFeature(required, 'entities.records.*')).toBe(true)
    expect(matchFeature(required, 'entities.*')).toBe(true)
    expect(matchFeature(required, '*')).toBe(true)
  })

  test('an entityId with a colon stays a single segment (no cross-entity leakage)', () => {
    const salaries = deriveCustomEntityRecordFeature('hr:salaries', 'view')
    const vendors = deriveCustomEntityRecordFeature('user:vendors', 'view')
    // Granting one entity must not satisfy another.
    expect(hasAllFeatures([vendors], [salaries])).toBe(false)
    // A wildcard scoped to a different concrete entity path must not match.
    expect(matchFeature(salaries, 'entities.records.user:vendors.*')).toBe(false)
  })

  test('synthesized features carry coarse prerequisites in dependsOn', () => {
    const [view, manage] = synthesizedRecordFeatures('hr:salaries')
    expect(view).toEqual({
      id: 'entities.records.hr:salaries.view',
      action: 'view',
      dependsOn: [RECORDS_VIEW_FEATURE],
    })
    expect(manage).toEqual({
      id: 'entities.records.hr:salaries.manage',
      action: 'manage',
      dependsOn: ['entities.records.hr:salaries.view', RECORDS_MANAGE_FEATURE],
    })
  })
})
