import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const taskScopeGuard: MutationGuard = {
  id: 'reference_module.task-scope',
  targetEntity: 'reference_module.reference_task',
  operations: ['create', 'update', 'delete'],
  features: ['reference_module.manage'],
  priority: 10,
  async validate(input) {
    if (!input.tenantId || !input.organizationId) {
      return { ok: false, status: 403, message: 'A trusted organization scope is required' }
    }
    const payload = input.mutationPayload ?? {}
    if ('tenantId' in payload || 'tenant_id' in payload || 'organizationId' in payload || 'organization_id' in payload) {
      return { ok: false, status: 422, message: 'Scope fields cannot be supplied by the caller' }
    }
    return { ok: true }
  },
}

const linkScopeGuard: MutationGuard = {
  id: 'reference_module.link-scope',
  targetEntity: 'reference_module.reference_task_link',
  operations: ['create', 'delete'],
  features: ['reference_module.manage'],
  priority: 10,
  async validate(input) {
    if (!input.tenantId || !input.organizationId || !input.resourceId) {
      return { ok: false, status: 403, message: 'A scoped parent task is required' }
    }
    return { ok: true }
  },
}

export const guards: MutationGuard[] = [taskScopeGuard, linkScopeGuard]
