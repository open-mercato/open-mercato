import { NextResponse } from 'next/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { SudoChallengeConfig } from '../../data/entities'
import type { SudoChallengeService, SudoChallengeServiceError } from '../../services/SudoChallengeService'
import { isSudoRequiredError } from '../../lib/sudo-middleware'

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type SudoRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  sudoChallengeService: SudoChallengeService
}

export function toSudoConfigResponse(config: SudoChallengeConfig) {
  return {
    id: config.id,
    tenantId: config.tenantId ?? null,
    organizationId: config.organizationId ?? null,
    targetType: config.targetType,
    targetIdentifier: config.targetIdentifier,
    isEnabled: config.isEnabled,
    isDeveloperDefault: config.isDeveloperDefault,
    ttlSeconds: config.ttlSeconds,
    challengeMethod: config.challengeMethod,
    configuredBy: config.configuredBy ?? null,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

export async function resolveSudoContext(req: Request): Promise<SudoRequestContext | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  return {
    auth,
    container,
    commandContext: {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: auth.orgId ? [auth.orgId] : null,
      request: req,
    },
    sudoChallengeService: container.resolve<SudoChallengeService>('sudoChallengeService'),
  }
}

export function mapSudoError(error: unknown): NextResponse {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(error.body, { status: error.status })
  }
  if (isSudoRequiredError(error)) {
    return NextResponse.json(error.body, { status: error.statusCode })
  }
  if (isSudoChallengeServiceError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('security.sudo.route failure', error)
  return NextResponse.json({ error: 'Failed to process sudo request.' }, { status: 500 })
}

function isSudoChallengeServiceError(error: unknown): error is SudoChallengeServiceError {
  return error instanceof Error
    && error.name === 'SudoChallengeServiceError'
    && typeof (error as Partial<SudoChallengeServiceError>).statusCode === 'number'
}
