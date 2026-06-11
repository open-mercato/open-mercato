import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { UserDevice } from '../data/entities'
import type {
  RegisterDeviceCommandInput,
  UpdateDeviceCommandInput,
  DeactivateDeviceCommandInput,
} from '../data/validators'
import { attachOperationMetadataHeader } from '../lib/operationMetadata'

const RESOURCE_KIND = 'devices.user_device'

// push_token is a secret. The mutation guard forwards mutationPayload into record-lock conflict
// details that are returned to clients, so strip the token before it reaches the guard.
function redactMutationPayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payload || !('pushToken' in payload)) return payload
  const { pushToken: _pushToken, ...rest } = payload
  return rest
}

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type OrganizationScope = Awaited<ReturnType<typeof resolveOrganizationScopeForRequest>>

// Shared mutation context for device write ops. `actorUserId` is the authenticated caller (used for
// the mutation guard / audit), independent of which user *owns* the device being mutated.
export type DeviceMutationContext = {
  container: RequestContainer
  auth: NonNullable<AuthContext>
  scope: OrganizationScope
  organizationId: string | null
  actorUserId: string
  request: Request
}

function commandCtx(mctx: DeviceMutationContext) {
  return {
    container: mctx.container,
    auth: mctx.auth,
    organizationScope: mctx.scope ?? null,
    selectedOrganizationId: mctx.organizationId,
    organizationIds: mctx.scope?.filterIds ?? (mctx.auth.orgId ? [mctx.auth.orgId] : null),
    request: mctx.request,
  }
}

async function runGuards(
  mctx: DeviceMutationContext,
  operation: 'create' | 'update' | 'delete',
  resourceId: string,
  mutationPayload?: Record<string, unknown>,
) {
  return validateCrudMutationGuard(mctx.container, {
    tenantId: mctx.auth.tenantId!,
    organizationId: mctx.organizationId,
    userId: mctx.actorUserId,
    resourceKind: RESOURCE_KIND,
    resourceId,
    operation,
    requestMethod: mctx.request.method,
    requestHeaders: mctx.request.headers,
    mutationPayload,
  })
}

async function runAfter(
  mctx: DeviceMutationContext,
  guardResult: Awaited<ReturnType<typeof validateCrudMutationGuard>>,
  operation: 'create' | 'update' | 'delete',
  resourceId: string,
) {
  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(mctx.container, {
      tenantId: mctx.auth.tenantId!,
      organizationId: mctx.organizationId,
      userId: mctx.actorUserId,
      resourceKind: RESOURCE_KIND,
      resourceId,
      operation,
      requestMethod: mctx.request.method,
      requestHeaders: mctx.request.headers,
      metadata: (guardResult.metadata as Record<string, unknown> | null | undefined) ?? null,
    })
  }
}

export async function executeRegister(
  mctx: DeviceMutationContext,
  commandInput: RegisterDeviceCommandInput,
): Promise<NextResponse> {
  // Register is an upsert, so the device row id isn't known until execution. Key the mutation guard
  // by the stable, tenant-unique upsert tuple so validate and after-success agree (record locks are
  // keyed by resourceId); deviceId alone is not unique across users.
  const guardResourceId = `${commandInput.userId}:${commandInput.deviceId}`
  const guardResult = await runGuards(mctx, 'create', guardResourceId, redactMutationPayload(commandInput))
  if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

  const commandBus = mctx.container.resolve('commandBus') as CommandBus
  const { result, logEntry } = await commandBus.execute<
    RegisterDeviceCommandInput,
    { id: string; deviceId: string; revived: boolean }
  >('devices.devices.register', { input: commandInput, ctx: commandCtx(mctx) })

  await runAfter(mctx, guardResult, 'create', guardResourceId)

  const response = NextResponse.json(
    { id: result.id, deviceId: result.deviceId, revived: result.revived },
    { status: 201 },
  )
  attachOperationMetadataHeader(response, logEntry, { resourceKind: RESOURCE_KIND, resourceId: result.id })
  return response
}

export async function executeUpdate(
  mctx: DeviceMutationContext,
  device: UserDevice,
  body: Omit<UpdateDeviceCommandInput, 'id' | 'tenantId' | 'userId' | 'organizationId'>,
): Promise<NextResponse> {
  // Device metadata edits carry lost-update risk (unlike the idempotent soft-delete deactivate), so
  // enforce OSS optimistic locking when the caller sends the expected-version header. No-ops when the
  // header is absent (e.g. mobile self-update clients), keeping the contract backward-compatible.
  enforceCommandOptimisticLock({
    resourceKind: RESOURCE_KIND,
    resourceId: device.id,
    current: device.updatedAt,
    request: mctx.request,
  })

  const guardResult = await runGuards(mctx, 'update', device.id, redactMutationPayload(body))
  if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

  const commandBus = mctx.container.resolve('commandBus') as CommandBus
  const { logEntry } = await commandBus.execute<UpdateDeviceCommandInput, { id: string }>('devices.devices.update', {
    input: {
      ...body,
      id: device.id,
      tenantId: device.tenantId,
      userId: device.userId,
      organizationId: device.organizationId ?? null,
    } satisfies UpdateDeviceCommandInput,
    ctx: commandCtx(mctx),
  })

  await runAfter(mctx, guardResult, 'update', device.id)

  const response = NextResponse.json({ ok: true, id: device.id })
  attachOperationMetadataHeader(response, logEntry, { resourceKind: RESOURCE_KIND, resourceId: device.id })
  return response
}

export async function executeDeactivate(
  mctx: DeviceMutationContext,
  device: UserDevice,
): Promise<NextResponse> {
  const guardResult = await runGuards(mctx, 'delete', device.id)
  if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

  const commandBus = mctx.container.resolve('commandBus') as CommandBus
  const { logEntry } = await commandBus.execute<DeactivateDeviceCommandInput, { id: string }>(
    'devices.devices.deactivate',
    {
      input: {
        id: device.id,
        tenantId: device.tenantId,
        userId: device.userId,
        organizationId: device.organizationId ?? null,
      } satisfies DeactivateDeviceCommandInput,
      ctx: commandCtx(mctx),
    },
  )

  await runAfter(mctx, guardResult, 'delete', device.id)

  const response = NextResponse.json({ ok: true })
  attachOperationMetadataHeader(response, logEntry, { resourceKind: RESOURCE_KIND, resourceId: device.id })
  return response
}
