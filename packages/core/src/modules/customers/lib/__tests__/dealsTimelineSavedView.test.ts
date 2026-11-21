import {
  buildDealTimelinePerspectiveSettings,
  normalizeTimelineStatusSelection,
  parseDealTimelineSavedView,
  validateDealTimelineSavedViewForSave,
  type DealTimelineSavedView,
} from '../dealsTimelineSavedView'
import { dealTimelineSavedViewSchema } from '../../data/validators'

const ownerId = '11111111-1111-4111-8111-111111111111'
const pipelineId = '22222222-2222-4222-8222-222222222222'

describe('dealsTimelineSavedView', () => {
  it('parses a valid v1 payload', () => {
    const { view, droppedFields } = parseDealTimelineSavedView({
      filters: {
        timeline: {
          v: 1,
          status: ['open'],
          pipelineId,
          ownerUserId: [ownerId],
          personId: [],
          companyId: [],
          excludeClosed: false,
          groupBy: 'stage',
          bucket: 'quarter',
        },
      },
      searchValue: 'acme',
    })
    expect(droppedFields).toEqual([])
    expect(view).toEqual({
      status: ['open'],
      pipelineId,
      ownerUserId: [ownerId],
      personId: [],
      companyId: [],
      excludeClosed: false,
      groupBy: 'stage',
      bucket: 'quarter',
      search: 'acme',
    })
  })

  it('falls back field by field and never throws', () => {
    const { view, droppedFields } = parseDealTimelineSavedView({
      filters: { timeline: { v: 1, bucket: 'day', groupBy: 'stage', ownerUserId: ['nope'], pipelineId } },
    })
    expect(view.bucket).toBe('week')
    expect(view.groupBy).toBe('stage')
    expect(view.ownerUserId).toEqual([])
    expect(view.pipelineId).toBe(pipelineId)
    expect(view.excludeClosed).toBe(true)
    expect(droppedFields).toEqual(expect.arrayContaining(['bucket', 'ownerUserId']))
  })

  it('drops oversize value lists instead of throwing', () => {
    const tooMany = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    const { view, droppedFields } = parseDealTimelineSavedView({
      filters: { timeline: { v: 1, ownerUserId: tooMany, groupBy: 'stage' } },
    })
    expect(view.ownerUserId).toEqual([])
    expect(view.groupBy).toBe('stage')
    expect(droppedFields).toContain('ownerUserId')
  })

  it('returns defaults for missing, foreign or older payloads', () => {
    expect(parseDealTimelineSavedView(null).view.bucket).toBe('week')
    expect(parseDealTimelineSavedView({ columnOrder: ['a'] }).droppedFields).toEqual(['timeline'])
    const older = parseDealTimelineSavedView({ filters: { timeline: { v: 0, groupBy: 'stage' } } })
    expect(older.droppedFields).toContain('v')
    expect(older.view.groupBy).toBe('stage')
  })

  it('removes closed statuses when closed deals are hidden', () => {
    const { view } = parseDealTimelineSavedView({
      filters: { timeline: { v: 1, status: ['open', 'win', 'Won', 'loose'], excludeClosed: true } },
    })
    expect(view.status).toEqual(['open'])
    expect(normalizeTimelineStatusSelection(['open', 'lost'], false)).toEqual(['open', 'lost'])
  })

  it('builds a payload that validates against the schema and round-trips', () => {
    const settings = buildDealTimelinePerspectiveSettings({
      status: ['win'],
      pipelineId: null,
      ownerUserId: [ownerId],
      personId: [],
      companyId: [],
      excludeClosed: false,
      groupBy: 'owner',
      bucket: 'month',
      search: 'beta',
    })
    expect(settings.filters.__namespaced).toBe(true)
    expect(dealTimelineSavedViewSchema.safeParse(settings.filters.timeline).success).toBe(true)
    expect(parseDealTimelineSavedView(settings).view).toMatchObject({ status: ['win'], bucket: 'month', search: 'beta' })
    expect(parseDealTimelineSavedView(settings).droppedFields).toEqual([])
  })

  describe('validateDealTimelineSavedViewForSave', () => {
    const baseView: DealTimelineSavedView = {
      status: [],
      pipelineId,
      ownerUserId: [ownerId],
      personId: [],
      companyId: [],
      excludeClosed: true,
      groupBy: 'owner',
      bucket: 'week',
    }
    const manyIds = (length: number) =>
      Array.from({ length }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)

    it('accepts a view that will load back unchanged', () => {
      expect(validateDealTimelineSavedViewForSave(baseView)).toEqual({ ok: true })
      expect(validateDealTimelineSavedViewForSave({ ...baseView, ownerUserId: manyIds(100) })).toEqual({ ok: true })
    })

    it('rejects lists the loader would drop and names the field', () => {
      expect(validateDealTimelineSavedViewForSave({ ...baseView, ownerUserId: manyIds(101) })).toEqual({
        ok: false,
        field: 'ownerUserId',
      })
      expect(validateDealTimelineSavedViewForSave({ ...baseView, companyId: manyIds(101) })).toEqual({
        ok: false,
        field: 'companyId',
      })
    })

    it('rejects an overlong status value and an overlong search', () => {
      expect(
        validateDealTimelineSavedViewForSave({ ...baseView, excludeClosed: false, status: ['x'.repeat(101)] }),
      ).toEqual({ ok: false, field: 'status' })
      expect(validateDealTimelineSavedViewForSave({ ...baseView, search: 's'.repeat(201) })).toEqual({
        ok: false,
        field: 'search',
      })
    })
  })
})
