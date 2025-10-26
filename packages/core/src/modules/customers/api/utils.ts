import {
  withScopedPayload as baseWithScopedPayload,
  parseScopedCommandInput as baseParseScopedCommandInput,
  type ScopedPayloadOptions,
  type TranslateFn,
  type ScopedContext,
} from '@open-mercato/shared/lib/api/scoped'
import type { z } from 'zod'

const messageOverrides = {
  tenantRequired: { key: 'customers.errors.tenant_required', fallback: 'Tenant context is required' },
  organizationRequired: { key: 'customers.errors.organization_required', fallback: 'Organization context is required' },
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
