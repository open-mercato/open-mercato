import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CustomerInvitationService } from '../services/customerInvitationService'
import { cancelInvitationSchema, type CancelInvitationInput } from '../data/validators'
import { emitCustomerAccountsEvent } from '../events'

export type CancelInvitationResult = { cancelled: boolean; tenantId: string; organizationId: string }

const logger = createLogger('customer_accounts').child({ component: 'invitation-cancellation' })

export const cancelInvitationCommand: CommandHandler<CancelInvitationInput, CancelInvitationResult> = {
  id: 'customer_accounts.invitation.cancel',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = cancelInvitationSchema.parse(input)
    const auth = ctx.auth
    const { translate } = await resolveTranslations()
    if (!auth?.sub) {
      throw new CrudHttpError(401, { error: translate('customer_accounts.errors.cancelInvitationAuth') })
    }
    const organizationScope = ctx.organizationScope ?? await resolveOrganizationScopeForRequest({
      container: ctx.container,
      auth,
      request: ctx.request,
      selectedId: ctx.request ? undefined : ctx.selectedOrganizationId ?? undefined,
    })
    if (organizationScope.selectionRejected || !organizationScope.tenantId || !organizationScope.selectedId) {
      throw new CrudHttpError(403, { error: translate('customer_accounts.errors.cancelInvitationPermission') })
    }
    const scope = { tenantId: organizationScope.tenantId, organizationId: organizationScope.selectedId }
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
        try {
          getTelemetryRuntime()?.reportError(error, { module: 'customer_accounts', code: 'customer_accounts.invitation_cancel_event_failed' })
        } catch (reportingError) {
          logger.warn('Invitation cancellation event reporting failed', { err: reportingError })
        }
      }
    }
    return { cancelled, ...scope }
  },
  async buildLog({ input, result }) {
    if (!result.cancelled) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      replayable: false,
      resourceKind: 'customer_accounts.customer_user_invitation',
      resourceId: input.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      actionLabel: translate('customer_accounts.actions.cancelInvitation'),
    }
  },
}

registerCommand(cancelInvitationCommand)
