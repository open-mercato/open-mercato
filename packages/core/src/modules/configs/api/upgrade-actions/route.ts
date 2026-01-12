import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { executeUpgradeAction, getCurrentVersion, isUpgradeActionsEnabled, listPendingUpgradeActions } from '../../services/upgradeActionsService'
import type { EntityManager } from '@mikro-orm/postgresql'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.manage'] },
  POST: { requireAuth: true, requireFeatures: ['configs.manage'] },
} as const

const runSchema = z.object({
  actionId: z.string().trim().min(1, 'action id required'),
})

type Scope = { tenantId: string; organizationId: string }

async function resolveScope(
  req: Request,
  translate: (key: string, fallback?: string, params?: Record<string, unknown>) => string,
): Promise<{ scope: Scope | null; container: Awaited<ReturnType<typeof createRequestContainer>> | null; error?: Response }> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return { scope: null, container: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const container = await createRequestContainer()
  const featureContext = await resolveFeatureCheckContext({ container, auth, request: req })
  const tenantId = featureContext.scope.tenantId ?? auth.tenantId ?? null
  const organizationId = featureContext.organizationId ?? featureContext.scope.selectedId ?? auth.orgId ?? null
  if (!tenantId || !organizationId) {
    const message = translate(
      'upgrades.scopeRequired',
      'Select an organization and tenant to apply this upgrade.'
    )
    return { scope: null, container, error: NextResponse.json({ error: message }, { status: 400 }) }
  }
  return {
    scope: { tenantId, organizationId },
    container,
  }
}

export async function GET(req: Request) {
  if (!isUpgradeActionsEnabled()) {
    return NextResponse.json({ version: getCurrentVersion(), actions: [] })
  }
  const { translate } = await resolveTranslations()
  const scopedTranslate = (key: string, fallback?: string, params?: Record<string, unknown>) =>
    translate(key, fallback, params as any)
  const scopeResult = await resolveScope(req, scopedTranslate)
  if (!scopeResult.scope) return scopeResult.error!

  const container = scopeResult.container ?? (await createRequestContainer())
  const em = container.resolve<EntityManager>('em')
  const version = getCurrentVersion()
  try {
    const actions = await listPendingUpgradeActions(em, { ...scopeResult.scope, version })
    const nextAction = actions[0]
    const payload = nextAction
      ? [{
        id: nextAction.id,
        version: nextAction.version,
        message: translate(
          nextAction.messageKey,
          'The version {{version}} has been installed. To fully use all the features from this edition please do "Install example catalog products and categories".',
          { version: nextAction.version }
        ),
        ctaLabel: translate(
          nextAction.ctaKey,
          'Install example catalog products and categories'
        ),
        successMessage: translate(
          nextAction.successKey,
          'Example catalog products and categories installed.'
        ),
        loadingLabel: nextAction.loadingKey
          ? translate(nextAction.loadingKey, 'Installing…')
          : translate('upgrades.loading', 'Installing…'),
      }]
      : []
    return NextResponse.json({ version, actions: payload })
  } catch (error) {
    console.error('[configs.upgrade-actions] failed to load upgrade actions', error)
    return NextResponse.json({ error: 'Failed to load upgrade actions' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!isUpgradeActionsEnabled()) {
    return NextResponse.json({ error: 'Upgrade actions are disabled' }, { status: 403 })
  }
  const { translate } = await resolveTranslations()
  const scopedTranslate = (key: string, fallback?: string, params?: Record<string, unknown>) =>
    translate(key, fallback, params as any)
  const scopeResult = await resolveScope(req, scopedTranslate)
  if (!scopeResult.scope) return scopeResult.error!

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    parsedBody = null
  }
  const parsed = runSchema.safeParse(parsedBody || {})
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const container = scopeResult.container ?? (await createRequestContainer())
  const version = getCurrentVersion()

  try {
    const result = await executeUpgradeAction(container, {
      actionId: parsed.data.actionId,
      tenantId: scopeResult.scope.tenantId,
      organizationId: scopeResult.scope.organizationId,
      version,
    })
    const successMessage = translate(
      result.action.successKey,
      'Example catalog products and categories installed.'
    )
    return NextResponse.json({
      status: result.status,
      message: successMessage,
      version,
    })
  } catch (error) {
    console.error('[configs.upgrade-actions] failed to execute upgrade action', error)
    const message = translate('upgrades.runFailed', 'We could not run this upgrade action.')
    const details = error instanceof Error ? error.message : null
    return NextResponse.json({ error: message, details }, { status: 500 })
  }
}
