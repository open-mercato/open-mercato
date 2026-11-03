import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * Fixtures shared by the staff time-tracking specs.
 *
 * US-B1 / D-9: creating a time project requires a customer, and `customerId`
 * points at the customers-module supertype (`customers.customer_entities`).
 * Every spec that creates a project therefore has to bring its own customer —
 * seeded or demo customers must never be relied on.
 *
 * Both fixtures expose an idempotent `cleanup()` that never throws, so a spec
 * can call it from `finally` no matter how the test body ended.
 */

const CUSTOMER_COMPANIES_PATH = '/api/customers/companies'
const TIME_PROJECTS_PATH = '/api/staff/timesheets/time-projects'

export type TestCustomerFixture = {
  id: string
  displayName: string
  cleanup: () => Promise<void>
}

export type TestTimeProjectFixture = {
  id: string
  name: string
  code: string
  customer: TestCustomerFixture
  cleanup: () => Promise<void>
}

/**
 * Creates a customer (a customers-module company, whose `id` is the customer
 * entity id) in the tenant/organization the token is scoped to.
 */
export async function createTestCustomer(
  request: APIRequestContext,
  token: string,
  options: { displayName?: string } = {},
): Promise<TestCustomerFixture> {
  const displayName = options.displayName ?? `QA Time Tracking Customer ${Date.now()}`
  const id = await createCompanyFixture(request, token, displayName)

  let cleaned = false
  return {
    id,
    displayName,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await deleteEntityIfExists(request, token, CUSTOMER_COMPANIES_PATH, id)
    },
  }
}

/**
 * Creates a time project together with the customer it must name. Pass an
 * existing `customer` to reuse one; otherwise a dedicated customer is created
 * and removed again by `cleanup()`.
 */
export async function createTestTimeProject(
  request: APIRequestContext,
  token: string,
  input: { name: string; code: string; customer?: TestCustomerFixture; projectType?: string },
): Promise<TestTimeProjectFixture> {
  const ownsCustomer = !input.customer
  const customer = input.customer ?? (await createTestCustomer(request, token, { displayName: `${input.name} Customer` }))

  let projectId: string
  try {
    const response = await apiRequest(request, 'POST', TIME_PROJECTS_PATH, {
      token,
      data: {
        name: input.name,
        code: input.code,
        customerId: customer.id,
        projectType: input.projectType ?? 'internal',
        status: 'active',
      },
    })
    expect(response.ok(), `Failed to create time project fixture: ${response.status()}`).toBeTruthy()
    const body = (await response.json()) as { id?: string | null }
    expect(typeof body.id === 'string' && body.id.length > 0, 'Time project fixture should expose its id').toBeTruthy()
    projectId = body.id as string
  } catch (error) {
    if (ownsCustomer) await customer.cleanup()
    throw error
  }

  let cleaned = false
  return {
    id: projectId,
    name: input.name,
    code: input.code,
    customer,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await apiRequest(request, 'DELETE', `${TIME_PROJECTS_PATH}?id=${encodeURIComponent(projectId)}`, { token })
        .catch(() => {})
      if (ownsCustomer) await customer.cleanup()
    },
  }
}
