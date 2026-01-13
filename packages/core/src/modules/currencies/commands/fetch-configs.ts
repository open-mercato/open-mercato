import type { EntityManager } from '@mikro-orm/core'
import { z } from 'zod'
import { CurrencyFetchConfig } from '../data/entities'
import {
  currencyFetchConfigCreateSchema,
  currencyFetchConfigUpdateSchema,
} from '../data/validators'

export interface FetchConfigCommandScope {
  tenantId: string
  organizationId: string
  userId?: string
}

export async function createFetchConfig(
  em: EntityManager,
  input: z.infer<typeof currencyFetchConfigCreateSchema>,
  scope: FetchConfigCommandScope
): Promise<CurrencyFetchConfig> {
  // Validate input
  const validated = currencyFetchConfigCreateSchema.parse(input)

  // Check for duplicate provider
  const existing = await em.findOne(CurrencyFetchConfig, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    provider: validated.provider,
  })

  if (existing) {
    throw new Error(`Provider ${validated.provider} already configured`)
  }

  // Create config
  const config = em.create(CurrencyFetchConfig, {
    ...validated,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await em.persistAndFlush(config)
  return config
}

export async function updateFetchConfig(
  em: EntityManager,
  id: string,
  input: z.infer<typeof currencyFetchConfigUpdateSchema>,
  scope: FetchConfigCommandScope
): Promise<CurrencyFetchConfig> {
  const validated = currencyFetchConfigUpdateSchema.parse(input)

  const config = await em.findOne(CurrencyFetchConfig, {
    id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  if (!config) {
    throw new Error('Fetch config not found')
  }

  em.assign(config, validated)
  await em.persistAndFlush(config)

  return config
}

export async function deleteFetchConfig(
  em: EntityManager,
  id: string,
  scope: FetchConfigCommandScope
): Promise<void> {
  const config = await em.findOne(CurrencyFetchConfig, {
    id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  if (!config) {
    throw new Error('Fetch config not found')
  }

  await em.removeAndFlush(config)
}
