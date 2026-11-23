import { z } from 'zod'
import {
  DEAL_TIMELINE_SAVED_VIEW_MAX_SEARCH_LENGTH,
  DEAL_TIMELINE_SAVED_VIEW_VERSION,
  dealTimelineSavedViewSchema,
} from '../data/validators'
import type { DealTimelineBucket, DealTimelineGroupBy } from './dealsTimeline'
import { isClosedDealStatus } from './dealStatus'

export type DealTimelineSavedView = {
  status: string[]
  pipelineId: string | null
  ownerUserId: string[]
  personId: string[]
  companyId: string[]
  excludeClosed: boolean
  groupBy: DealTimelineGroupBy
  bucket: DealTimelineBucket
  search?: string
}

export type DealTimelinePerspectiveSettings = {
  filters: { __namespaced: true; timeline: z.infer<typeof dealTimelineSavedViewSchema> }
  searchValue?: string
}

export type ParsedDealTimelineSavedView = {
  view: DealTimelineSavedView
  droppedFields: string[]
}

const shape = dealTimelineSavedViewSchema.shape

const DEFAULT_VIEW: DealTimelineSavedView = {
  status: [],
  pipelineId: null,
  ownerUserId: [],
  personId: [],
  companyId: [],
  excludeClosed: true,
  groupBy: 'owner',
  bucket: 'week',
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readField<T>(
  source: Record<string, unknown>,
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
  dropped: string[],
): T {
  if (!(key in source) || source[key] === undefined) return fallback
  const parsed = schema.safeParse(source[key])
  if (parsed.success) return parsed.data
  dropped.push(key)
  return fallback
}

export function normalizeTimelineStatusSelection(status: string[], excludeClosed: boolean): string[] {
  return excludeClosed ? status.filter((value) => !isClosedDealStatus(value.toLowerCase())) : status
}

export function parseDealTimelineSavedView(input: unknown): ParsedDealTimelineSavedView {
  const dropped: string[] = []
  const settings = readRecord(input)
  const filters = readRecord(settings?.filters)
  const timeline = readRecord(filters?.timeline)
  const searchValue = typeof settings?.searchValue === 'string' && settings.searchValue.trim().length
    ? settings.searchValue
    : undefined
  if (!timeline) {
    if (settings) dropped.push('timeline')
    return { view: { ...DEFAULT_VIEW, ...(searchValue ? { search: searchValue } : {}) }, droppedFields: dropped }
  }
  if (timeline.v !== DEAL_TIMELINE_SAVED_VIEW_VERSION) dropped.push('v')
  const excludeClosed = readField(timeline, 'excludeClosed', shape.excludeClosed.removeDefault(), DEFAULT_VIEW.excludeClosed, dropped)
  const status = readField(timeline, 'status', shape.status.removeDefault(), DEFAULT_VIEW.status, dropped)
  const view: DealTimelineSavedView = {
    status: normalizeTimelineStatusSelection(status, excludeClosed),
    pipelineId: readField(timeline, 'pipelineId', shape.pipelineId.removeDefault(), DEFAULT_VIEW.pipelineId, dropped),
    ownerUserId: readField(timeline, 'ownerUserId', shape.ownerUserId.removeDefault(), DEFAULT_VIEW.ownerUserId, dropped),
    personId: readField(timeline, 'personId', shape.personId.removeDefault(), DEFAULT_VIEW.personId, dropped),
    companyId: readField(timeline, 'companyId', shape.companyId.removeDefault(), DEFAULT_VIEW.companyId, dropped),
    excludeClosed,
    groupBy: readField(timeline, 'groupBy', shape.groupBy.removeDefault(), DEFAULT_VIEW.groupBy, dropped),
    bucket: readField(timeline, 'bucket', shape.bucket.removeDefault(), DEFAULT_VIEW.bucket, dropped),
  }
  if (searchValue) view.search = searchValue
  return { view, droppedFields: dropped }
}

export function buildDealTimelinePerspectiveSettings(view: DealTimelineSavedView): DealTimelinePerspectiveSettings {
  const settings: DealTimelinePerspectiveSettings = {
    filters: {
      __namespaced: true,
      timeline: {
        v: DEAL_TIMELINE_SAVED_VIEW_VERSION,
        status: normalizeTimelineStatusSelection(view.status, view.excludeClosed),
        pipelineId: view.pipelineId,
        ownerUserId: view.ownerUserId,
        personId: view.personId,
        companyId: view.companyId,
        excludeClosed: view.excludeClosed,
        groupBy: view.groupBy,
        bucket: view.bucket,
      },
    },
  }
  if (view.search && view.search.trim().length) settings.searchValue = view.search
  return settings
}

export type DealTimelineSavedViewSaveCheck = { ok: true } | { ok: false; field: string }

export function validateDealTimelineSavedViewForSave(view: DealTimelineSavedView): DealTimelineSavedViewSaveCheck {
  const settings = buildDealTimelinePerspectiveSettings(view)
  const parsed = dealTimelineSavedViewSchema.safeParse(settings.filters.timeline)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return { ok: false, field: typeof field === 'string' ? field : 'timeline' }
  }
  if (settings.searchValue && settings.searchValue.length > DEAL_TIMELINE_SAVED_VIEW_MAX_SEARCH_LENGTH) {
    return { ok: false, field: 'search' }
  }
  return { ok: true }
}
