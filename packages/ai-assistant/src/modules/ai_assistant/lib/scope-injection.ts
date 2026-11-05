import type { McpToolContext } from './types'

/**
 * Tenant/org scope for outgoing api.request() calls is derived strictly from the
 * operating context — never from sandbox (AI-authored) code. Any tenantId/organizationId
 * the sandbox placed in query/body is stripped first, then re-applied from ctx only when
 * present. When the ctx scope is null the fields stay removed (fail closed), so AI-supplied
 * scope can never survive regardless of whether the context is tenant-bound.
 *
 * Path safety (traversal, percent-encoded separators, embedded query strings) is handled
 * upstream by normalizeApiRequestPath / isUnsafeApiRequestPath in codemode-tools.
 */

const SCOPE_FIELDS = ['tenantId', 'organizationId'] as const

// Dropped from any sandbox-supplied payload defensively so a top-level "__proto__" (etc.)
// can never ride along to a downstream handler that merges request data unsafely.
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const

type ContextScope = Pick<McpToolContext, 'tenantId' | 'organizationId'>

export function applyContextScopeToQuery(
  query: Record<string, string> | undefined,
  ctx: ContextScope
): Record<string, string> {
  const result: Record<string, string> = { ...query }
  for (const field of DANGEROUS_KEYS) delete result[field]
  for (const field of SCOPE_FIELDS) delete result[field]
  if (ctx.tenantId) result.tenantId = ctx.tenantId
  if (ctx.organizationId) result.organizationId = ctx.organizationId
  return result
}

export function applyContextScopeToBody(
  body: Record<string, unknown> | undefined,
  ctx: ContextScope
): Record<string, unknown> {
  // Object spread copies own enumerable props via data-property definition (not the
  // `__proto__` setter), so the result is a plain object; deleting the dangerous keys
  // then removes any that rode in as own properties.
  const result: Record<string, unknown> = { ...body }
  for (const field of DANGEROUS_KEYS) delete result[field]
  for (const field of SCOPE_FIELDS) delete result[field]
  if (ctx.tenantId) result.tenantId = ctx.tenantId
  if (ctx.organizationId) result.organizationId = ctx.organizationId
  return result
}
