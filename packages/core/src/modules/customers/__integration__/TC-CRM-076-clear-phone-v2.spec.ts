import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

type CustomerDetail = {
  company?: {
    id?: string | null
    displayName?: string | null
    primaryPhone?: string | null
    updatedAt?: string | null
    updated_at?: string | null
  }
  person?: {
    id?: string | null
    displayName?: string | null
    primaryPhone?: string | null
    updatedAt?: string | null
    updated_at?: string | null
  }
}

function resolveVersion(detail: CustomerDetail): string {
  const record = detail.company ?? detail.person
  const raw = record?.updatedAt ?? record?.updated_at
  expect(typeof raw, 'customer detail should expose updatedAt for optimistic locking').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

async function readCustomerDetail(
  request: APIRequestContext,
  token: string,
  kind: 'companies' | 'people',
  id: string,
): Promise<CustomerDetail> {
  const response = await apiRequest(request, 'GET', `/api/customers/${kind}/${encodeURIComponent(id)}`, { token })
  const body = await readJsonSafe<CustomerDetail>(response)
  expect(response.ok(), `Failed to read ${kind} detail: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body ?? {}
}

async function updateCustomer(
  request: APIRequestContext,
  token: string,
  kind: 'companies' | 'people',
  detail: CustomerDetail,
  data: Record<string, unknown>,
) {
  const response = await request.fetch(resolveUrl(`/api/customers/${kind}`), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER]: resolveVersion(detail),
    },
    data,
  })
  const body = await readJsonSafe(response)
  expect(response.ok(), `Failed to update ${kind}: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
}

test.describe('TC-CRM-076: Customers v2 phone clearing persists after reload', () => {
  test('person primaryPhone can be cleared', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null

    try {
      const stamp = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: 'Phone',
        lastName: `Clear ${stamp}`,
        displayName: `Phone Clear Person ${stamp}`,
      })

      const created = await readCustomerDetail(request, token, 'people', personId)
      await updateCustomer(request, token, 'people', created, {
        id: personId,
        firstName: 'Phone',
        lastName: `Clear ${stamp}`,
        displayName: `Phone Clear Person ${stamp}`,
        primaryPhone: '+1 212 555 0176',
      })

      const withPhone = await readCustomerDetail(request, token, 'people', personId)
      expect(withPhone.person?.primaryPhone).toBe('+1 212 555 0176')

      await updateCustomer(request, token, 'people', withPhone, {
        id: personId,
        firstName: 'Phone',
        lastName: `Clear ${stamp}`,
        displayName: `Phone Clear Person ${stamp}`,
        primaryPhone: null,
      })

      const cleared = await readCustomerDetail(request, token, 'people', personId)
      expect(cleared.person?.primaryPhone ?? null).toBeNull()
    } finally {
      await deleteEntityByBody(request, token, '/api/customers/people', personId)
    }
  })

  test('company primaryPhone can be cleared', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let companyId: string | null = null

    try {
      const stamp = Date.now()
      const displayName = `Phone Clear Company ${stamp}`
      companyId = await createCompanyFixture(request, token, displayName)

      const created = await readCustomerDetail(request, token, 'companies', companyId)
      await updateCustomer(request, token, 'companies', created, {
        id: companyId,
        displayName,
        primaryPhone: '+1 212 555 0276',
      })

      const withPhone = await readCustomerDetail(request, token, 'companies', companyId)
      expect(withPhone.company?.primaryPhone).toBe('+1 212 555 0276')

      await updateCustomer(request, token, 'companies', withPhone, {
        id: companyId,
        displayName,
        primaryPhone: null,
      })

      const cleared = await readCustomerDetail(request, token, 'companies', companyId)
      expect(cleared.company?.primaryPhone ?? null).toBeNull()
    } finally {
      await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
    }
  })
})
