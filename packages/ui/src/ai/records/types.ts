import type { TagVariant } from '../../primitives/tag'

export type RecordCardKind =
  | 'deal'
  | 'person'
  | 'company'
  | 'product'
  | 'activity'

export interface RecordCardBaseProps {
  id?: string
  href?: string
  className?: string
}

export interface DealRecordPayload extends RecordCardBaseProps {
  title: string
  status?: string | null
  stage?: string | null
  amount?: string | number | null
  currency?: string | null
  closeDate?: string | null
  ownerName?: string | null
  personName?: string | null
  companyName?: string | null
  description?: string | null
  tags?: string[] | null
}

export interface PersonRecordPayload extends RecordCardBaseProps {
  name: string
  title?: string | null
  email?: string | null
  phone?: string | null
  companyName?: string | null
  ownerName?: string | null
  status?: string | null
  tags?: string[] | null
  avatarUrl?: string | null
}

export interface CompanyRecordPayload extends RecordCardBaseProps {
  name: string
  industry?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  city?: string | null
  country?: string | null
  ownerName?: string | null
  status?: string | null
  tags?: string[] | null
  logoUrl?: string | null
}

export interface ProductRecordPayload extends RecordCardBaseProps {
  name: string
  sku?: string | null
  price?: string | number | null
  currency?: string | null
  status?: string | null
  category?: string | null
  description?: string | null
  imageUrl?: string | null
  tags?: string[] | null
}

export interface ActivityRecordPayload extends RecordCardBaseProps {
  title: string
  type?: string | null
  status?: string | null
  dueDate?: string | null
  completedAt?: string | null
  ownerName?: string | null
  relatedTo?: string | null
  description?: string | null
  tags?: string[] | null
}

export type RecordCardPayload =
  | ({ kind: 'deal' } & DealRecordPayload)
  | ({ kind: 'person' } & PersonRecordPayload)
  | ({ kind: 'company' } & CompanyRecordPayload)
  | ({ kind: 'product' } & ProductRecordPayload)
  | ({ kind: 'activity' } & ActivityRecordPayload)

export interface StatusToTag {
  variant: TagVariant
  label: string
}
