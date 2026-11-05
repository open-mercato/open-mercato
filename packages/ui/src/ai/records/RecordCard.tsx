"use client"

import * as React from 'react'
import { ActivityCard } from './ActivityCard'
import { CompanyCard } from './CompanyCard'
import { DealCard } from './DealCard'
import { PersonCard } from './PersonCard'
import { ProductCard } from './ProductCard'
import type { RecordCardPayload } from './types'

export interface RecordCardProps {
  data: RecordCardPayload
}

/**
 * Renders an Open Mercato record card based on the `kind` discriminator.
 * Used by the AI chat transcript to upgrade fenced ```open-mercato:<kind>```
 * blocks into rich, interactive widgets.
 */
export function RecordCard({ data }: RecordCardProps) {
  switch (data.kind) {
    case 'deal':
      return <DealCard {...data} />
    case 'person':
      return <PersonCard {...data} />
    case 'company':
      return <CompanyCard {...data} />
    case 'product':
      return <ProductCard {...data} />
    case 'activity':
      return <ActivityCard {...data} />
    default:
      return null
  }
}

export default RecordCard
