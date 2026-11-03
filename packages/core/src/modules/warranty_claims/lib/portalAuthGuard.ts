import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'

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
