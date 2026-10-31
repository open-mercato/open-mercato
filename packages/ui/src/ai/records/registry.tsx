"use client"

import * as React from 'react'
import {
  defaultAiUiPartRegistry,
  type AiUiPartProps,
} from '../ui-part-registry'
import { ActivityCard } from './ActivityCard'
import { DealCard } from './DealCard'
import { RecordCard } from './RecordCard'
import { withoutAiRecordImages } from '../imagePolicy'
import type {
  ActivityRecordPayload,
  CompanyRecordPayload,
  DealRecordPayload,
  PersonRecordPayload,
  ProductRecordPayload,
} from './types'

/**
 * Stable component ids the AI runtime can emit through the typed UI-parts
 * protocol. Each id renders the same record-card component used by the
 * inline fenced-block renderer, so a host can opt into either path without
 * duplicating UI code.
 */
export const RECORD_CARD_COMPONENT_IDS = [
  'open-mercato.deal-card',
  'open-mercato.person-card',
  'open-mercato.company-card',
  'open-mercato.product-card',
  'open-mercato.activity-card',
] as const

export type RecordCardComponentId = (typeof RECORD_CARD_COMPONENT_IDS)[number]

function DealCardPart({ payload }: AiUiPartProps) {
  return <DealCard {...((payload ?? {}) as DealRecordPayload)} />
}

function PersonCardPart({ payload }: AiUiPartProps) {
  return <RecordCard data={withoutAiRecordImages({ ...((payload ?? {}) as PersonRecordPayload), kind: 'person' })} />
}

function CompanyCardPart({ payload }: AiUiPartProps) {
  return <RecordCard data={withoutAiRecordImages({ ...((payload ?? {}) as CompanyRecordPayload), kind: 'company' })} />
}

function ProductCardPart({ payload }: AiUiPartProps) {
  return <RecordCard data={withoutAiRecordImages({ ...((payload ?? {}) as ProductRecordPayload), kind: 'product' })} />
}

function ActivityCardPart({ payload }: AiUiPartProps) {
  return <ActivityCard {...((payload ?? {}) as ActivityRecordPayload)} />
}

let registered = false

/**
 * Register the built-in record-card components on the module-global UI-part
 * registry. Idempotent; safe to call from app bootstrap or from a top-level
 * `<AiChat>` host. Hosts that need a scoped registry can re-register the
 * same ids on their own {@link createAiUiPartRegistry} instance.
 */
export function registerRecordCardUiParts(): void {
  if (registered) return
  registered = true
  defaultAiUiPartRegistry.register('open-mercato.deal-card', DealCardPart)
  defaultAiUiPartRegistry.register('open-mercato.person-card', PersonCardPart)
  defaultAiUiPartRegistry.register('open-mercato.company-card', CompanyCardPart)
  defaultAiUiPartRegistry.register('open-mercato.product-card', ProductCardPart)
  defaultAiUiPartRegistry.register(
    'open-mercato.activity-card',
    ActivityCardPart,
  )
}

// Auto-register at module load so consumers that import from
// `@open-mercato/ui/ai` get the cards wired up without manual bootstrap.
registerRecordCardUiParts()
