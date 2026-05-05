/**
 * `customers.get_settings` (Phase 1 WS-C, Step 3.9).
 *
 * Aggregates the four settings surfaces the spec calls out: pipelines,
 * pipeline stages, dictionaries, and address-format settings. All reads are
 * tenant + organization scoped through the existing encryption helpers.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerDictionaryEntry,
  CustomerPipeline,
  CustomerPipelineStage,
  CustomerSettings,
} from '../data/entities'
import { assertTenantScope, type CustomersAiToolDefinition, type CustomersToolContext } from './types'

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CustomersToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const getSettingsInput = z.object({}).passthrough()

const getSettingsTool: CustomersAiToolDefinition = {
  name: 'customers.get_settings',
  displayName: 'Get customers module settings',
  description:
    'Return the customers module settings for the caller scope: pipelines, pipeline stages, dictionaries (grouped by kind), and address format.',
  inputSchema: getSettingsInput,
  requiredFeatures: ['customers.settings.manage'],
  tags: ['read', 'customers'],
  handler: async (_rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const [pipelines, stages, dictionaryEntries, settings] = await Promise.all([
      findWithDecryption<CustomerPipeline>(
        em,
        CustomerPipeline,
        where as any,
        { orderBy: { createdAt: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      findWithDecryption<CustomerPipelineStage>(
        em,
        CustomerPipelineStage,
        where as any,
        { orderBy: { pipelineId: 'asc', order: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      findWithDecryption<CustomerDictionaryEntry>(
        em,
        CustomerDictionaryEntry,
        where as any,
        { orderBy: { kind: 'asc', label: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      ctx.organizationId
        ? findOneWithDecryption<CustomerSettings>(
            em,
            CustomerSettings,
            { tenantId, organizationId: ctx.organizationId } as any,
            undefined,
            buildScope(ctx, tenantId),
          )
        : null,
    ])
    const pipelineRows = pipelines.filter((row) => row.tenantId === tenantId)
    const stageRows = stages.filter((row) => row.tenantId === tenantId)
    const dictionaryRows = dictionaryEntries.filter((row) => row.tenantId === tenantId)
    const dictionaries: Record<string, Array<{
      id: string
      value: string
      label: string
      normalizedValue: string
      color: string | null
      icon: string | null
    }>> = {}
    for (const row of dictionaryRows) {
      const bucket = dictionaries[row.kind] ?? (dictionaries[row.kind] = [])
      bucket.push({
        id: row.id,
        value: row.value,
        label: row.label,
        normalizedValue: row.normalizedValue,
        color: row.color ?? null,
        icon: row.icon ?? null,
      })
    }
    return {
      pipelines: pipelineRows.map((row) => ({
        id: row.id,
        name: row.name,
        isDefault: !!row.isDefault,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      pipelineStages: stageRows.map((row) => ({
        id: row.id,
        pipelineId: row.pipelineId,
        label: row.label,
        order: row.order,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
      })),
      dictionaries,
      addressFormat: settings?.addressFormat ?? 'line_first',
    }
  },
}

export const settingsAiTools: CustomersAiToolDefinition[] = [getSettingsTool]

export default settingsAiTools
