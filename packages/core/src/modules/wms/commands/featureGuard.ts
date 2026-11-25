import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type RbacServiceLike = {
  userHasAllFeatures?: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

/**
 * Feature requirement for a WMS command. Each inner array is one acceptable
 * grant set (all features in it are required); the caller passes when it holds
 * any one of the sets. Mirrors the `requireFeatures` of every HTTP route that
 * dispatches the command, so other command-bus dispatchers (notification
 * actions, workflows, AI tools) cannot be a softer gate than the route.
 */
export type CommandFeatureRequirement = readonly (readonly string[])[]

async function callerHoldsFeatures(
  ctx: CommandRuntimeContext,
  userId: string,
  requirement: CommandFeatureRequirement,
): Promise<boolean> {
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    if (typeof rbac?.userHasAllFeatures !== 'function') return false
    const scope = {
      tenantId: ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
    for (const features of requirement) {
      if (await rbac.userHasAllFeatures(userId, [...features], scope)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Fail-closed for every authenticated caller: a present actor without a user id,
 * a missing rbacService, or a thrown check all deny. A context with no actor at
 * all (`auth: null`) is a trusted server-side dispatch (event subscribers and
 * workers such as sales-order reservation automation and the procurement
 * goods-receipt subscriber); HTTP routes always carry an actor because they
 * declare `requireAuth`, so they can never reach that branch.
 */
export async function assertCommandFeatures(
  ctx: CommandRuntimeContext,
  requirement: CommandFeatureRequirement,
): Promise<void> {
  if (!ctx.auth) return
  const userId = typeof ctx.auth.sub === 'string' && ctx.auth.sub.length > 0 ? ctx.auth.sub : null
  if (userId && (await callerHoldsFeatures(ctx, userId, requirement))) return
  const { translate } = await resolveTranslations()
  throw forbidden(translate('wms.errors.forbidden', 'Forbidden'))
}

export function withRequiredFeatures<TInput, TResult>(
  handler: CommandHandler<TInput, TResult>,
  requirement: CommandFeatureRequirement,
): CommandHandler<TInput, TResult> {
  const guarded: CommandHandler<TInput, TResult> = {
    ...handler,
    async execute(input, ctx) {
      await assertCommandFeatures(ctx, requirement)
      return handler.execute(input, ctx)
    },
  }
  const prepare = handler.prepare
  if (prepare) {
    guarded.prepare = async (input, ctx) => {
      await assertCommandFeatures(ctx, requirement)
      return prepare.call(handler, input, ctx)
    }
  }
  return guarded
}
