import { NextResponse } from 'next/server'
import type { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getCustomerAuthFromRequest, requireCustomerFeature, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'

export type LinkedCustomerAuthContext = CustomerAuthContext & { customerEntityId: string }

export async function resolveLinkedCustomerAuth(req: Request): Promise<LinkedCustomerAuthContext | Response> {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { ok: false, error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') },
      { status: 401 },
    )
  }
  if (!auth.customerEntityId) {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      {
        ok: false,
        error: translate(
          'warranty_claims.errors.customerAccountNotLinked',
          'Customer account is not linked to a customer record',
        ),
      },
      { status: 403 },
    )
  }
  return auth as LinkedCustomerAuthContext
}

export async function resolveAuthorizedLinkedCustomerAuth(
  req: Request,
  requiredFeature: string,
  container: Awaited<ReturnType<typeof createRequestContainer>>,
): Promise<LinkedCustomerAuthContext | Response> {
  const auth = await resolveLinkedCustomerAuth(req)
  if (auth instanceof Response) return auth
  try {
    await requireCustomerFeature(auth, [requiredFeature], container.resolve('customerRbacService'))
  } catch (error) {
    if (error instanceof Response) return error
    getTelemetryRuntime()?.reportError(error, { module: 'warranty_claims', code: 'warranty_claims.portal_authorization_failed' })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { ok: false, error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') },
      { status: 403 },
    )
  }
  return auth as LinkedCustomerAuthContext
}
