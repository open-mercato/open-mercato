import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CustomerInvitationService } from '../services/customerInvitationService'
import { cancelInvitationSchema, type CancelInvitationInput } from '../data/validators'
import { emitCustomerAccountsEvent } from '../events'

export type CancelInvitationResult = { cancelled: boolean }

const logger = createLogger('customer_accounts').child({ component: 'invitation-cancellation' })

export const cancelInvitationCommand: CommandHandler<CancelInvitationInput, CancelInvitationResult> = {
  id: 'customer_accounts.invitation.cancel',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = cancelInvitationSchema.parse(input)
    const auth = ctx.auth
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId || !auth.orgId) {
      throw new CrudHttpError(401, { error: translate('customer_accounts.errors.cancelInvitationAuth') })
    }
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const rbacService = ctx.container.resolve('rbacService') as RbacService
    if (!await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.invite'], scope)) {
      throw new CrudHttpError(403, { error: translate('customer_accounts.errors.cancelInvitationPermission') })
    }
    const service = ctx.container.resolve('customerInvitationService') as CustomerInvitationService
    const cancelled = await service.cancelInvitation(parsed.id, scope)
    if (cancelled) {
      try {
        await emitCustomerAccountsEvent('customer_accounts.invitation.cancelled', {
          invitationId: parsed.id,
          ...scope,
        })
      } catch (error) {
        logger.error('Invitation cancellation event failed', { err: error })
        getTelemetryRuntime()?.reportError(error, { module: 'customer_accounts', code: 'customer_accounts.invitation_cancel_event_failed' })
      }
    }
    return { cancelled }
  },
  async buildLog({ input, result, ctx }) {
    if (!result.cancelled) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      replayable: false,
      resourceKind: 'customer_accounts.customer_user_invitation',
      resourceId: input.id,
      tenantId: ctx.auth?.tenantId,
      organizationId: ctx.auth?.orgId,
      actionLabel: translate('customer_accounts.actions.cancelInvitation'),
    }
  },
}

registerCommand(cancelInvitationCommand)
