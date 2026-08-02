import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

const scopedInputInterceptor: CommandInterceptor = {
  id: 'reference_module.scoped-input',
  targetCommand: 'reference_module.*',
  features: ['reference_module.manage'],
  priority: 10,
  async beforeExecute(input, context) {
    if (!context.auth?.tenantId || !(context.selectedOrganizationId ?? context.auth.orgId)) {
      return { ok: false, message: 'A trusted organization scope is required' }
    }
    const record = asRecord(input)
    if (!record) return { ok: true }
    if ('tenantId' in record || 'tenant_id' in record || 'organizationId' in record || 'organization_id' in record) {
      return { ok: false, message: 'Scope fields cannot be supplied by the caller' }
    }
    const title = typeof record.title === 'string' ? record.title.trim() : null
    return title === null ? { ok: true } : { ok: true, modifiedInput: { title } }
  },
}

export const interceptors: CommandInterceptor[] = [scopedInputInterceptor]
