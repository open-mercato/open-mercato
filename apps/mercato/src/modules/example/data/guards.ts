import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

/**
 * Example mutation guard: limits the number of active todos per tenant.
 *
 * Demonstrates the guard contract — runs on `create` operations for `example.todo`.
 * The guard checks a simple policy before allowing the mutation to proceed.
 */
const todoLimitGuard: MutationGuard = {
  id: 'example.todo-limit',
  targetEntity: 'example.todo',
  operations: ['create'],
  priority: 50,

  async validate(input) {
    // Guard validates at the request level — business rules can check
    // organizational limits, feature flags, or other policy constraints.
    // For demonstration, we simply allow the operation.
    if (!input.organizationId) {
      return {
        ok: false,
        message: 'Organization is required to create todos',
        status: 422,
      }
    }
    return { ok: true }
  },
}

export const guards: MutationGuard[] = [todoLimitGuard]
