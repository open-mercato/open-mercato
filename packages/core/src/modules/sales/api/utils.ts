import {
  withScopedPayload as baseWithScopedPayload,
  parseScopedCommandInput as baseParseScopedCommandInput,
  requireRecordId as baseRequireRecordId,
  resolveCrudRecordId as baseResolveCrudRecordId,
  type ScopedPayloadOptions,
  type ScopedContext,
  type TranslateFn,
} from '@open-mercato/shared/lib/api/scoped'
import type { z } from 'zod'

const messageOverrides = {
  tenantRequired: { key: 'sales.configuration.errors.tenant_required', fallback: 'Tenant context is required.' },
  organizationRequired: { key: 'sales.configuration.errors.organization_required', fallback: 'Organization context is required.' },
  idRequired: { key: 'sales.configuration.errors.id_required', fallback: 'Record identifier is required.' },
} as const

function mergeOptions(options: { requireOrganization?: boolean } = {}): ScopedPayloadOptions {
  return {
    requireOrganization: options.requireOrganization,
    messages: messageOverrides,
  }
}

export function withScopedPayload<T extends Record<string, unknown>>(
  payload: T | null | undefined,
  ctx: ScopedContext,
  translate: TranslateFn,
  options: { requireOrganization?: boolean } = {}
): T & { tenantId: string; organizationId?: string } {
  return baseWithScopedPayload(payload, ctx, translate, mergeOptions(options))
}

export function parseScopedCommandInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  ctx: ScopedContext,
  translate: TranslateFn,
  options: { requireOrganization?: boolean } = {}
): z.infer<TSchema> & { customFields?: Record<string, unknown> } {
  return baseParseScopedCommandInput(schema, payload, ctx, translate, mergeOptions(options))
}

export function requireRecordId(
  candidate: unknown,
  ctx: ScopedContext,
  translate: TranslateFn
): string {
  return baseRequireRecordId(candidate, ctx, translate, mergeOptions())
}

export function resolveCrudRecordId(
  parsed: unknown,
  ctx: ScopedContext,
  translate: TranslateFn
): string {
  return baseResolveCrudRecordId(parsed, ctx, translate, mergeOptions())
}
