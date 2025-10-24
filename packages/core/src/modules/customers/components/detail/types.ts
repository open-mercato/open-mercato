"use client"

export type Translator = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string

export type TagSummary = { id: string; label: string; color?: string | null }

export type AddressSummary = {
  id: string
  name?: string | null
  purpose?: string | null
  addressLine1: string
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  isPrimary?: boolean
}

export type CommentSummary = {
  id: string
  body: string
  createdAt: string
  authorUserId?: string | null
  authorName?: string | null
  authorEmail?: string | null
  dealId?: string | null
  dealTitle?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

export type ActivityCustomFieldEntry = {
  key: string
  label: string
  value: unknown
  kind?: string | null
  multi?: boolean
}

export type ActivitySummary = {
  id: string
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  createdAt: string
  appearanceIcon?: string | null
  appearanceColor?: string | null
  entityId?: string | null
  authorUserId?: string | null
  authorName?: string | null
  authorEmail?: string | null
  dealId?: string | null
  dealTitle?: string | null
  customValues?: Record<string, unknown> | null
  customFields?: ActivityCustomFieldEntry[]
}

export type DealCustomFieldEntry = {
  key: string
  label?: string | null
  value: unknown
  kind?: string | null
  multi?: boolean
}

export type DealSummary = {
  id: string
  title: string
  status?: string | null
  pipelineStage?: string | null
  valueAmount?: number | string | null
  valueCurrency?: string | null
  probability?: number | string | null
  expectedCloseAt?: string | null
  description?: string | null
  ownerUserId?: string | null
  source?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  customValues?: Record<string, unknown> | null
  customFields?: DealCustomFieldEntry[]
  personIds?: string[]
  companyIds?: string[]
  people?: { id: string; label: string }[]
  companies?: { id: string; label: string }[]
}

export type TodoLinkSummary = {
  id: string
  todoId: string
  todoSource: string
  createdAt: string
  createdByUserId?: string | null
  title?: string | null
  isDone?: boolean | null
  priority?: number | null
  severity?: string | null
  description?: string | null
  dueAt?: string | null
  todoOrganizationId?: string | null
  customValues?: Record<string, unknown> | null
}

export type SectionAction = {
  label: string
  onClick: () => void
  disabled?: boolean
}

export type TabEmptyState = {
  title: string
  actionLabel: string
}
