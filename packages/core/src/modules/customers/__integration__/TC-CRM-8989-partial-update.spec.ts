import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-CRM-8989: a partial person update preserves unrelated fields', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const marker = `tc8989-${randomUUID()}`
  const original = {
    displayName: marker,
    firstName: 'Scope',
    lastName: 'Isolation',
    primaryEmail: `${marker}@example.com`,
    primaryPhone: '+1 212 555 8989',
    description: `${marker} original description`,
    jobTitle: 'Scope engineer',
  }
  let personId: string | null = null
  type Detail = { person: Record<string, unknown> & { updatedAt?: string }; profile: Record<string, unknown> }
  try {
    const created = await apiRequest(request, 'POST', '/api/customers/people', { token, data: original })
    const createdBody = await readJsonSafe<{ id?: string }>(created)
    personId = typeof createdBody?.id === 'string' ? createdBody.id : null
    expect(created.status(), await created.text()).toBe(201)
    expectId(personId, 'created person id')
    const read = async () => {
      const response = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token })
      expect(response.status(), await response.text()).toBe(200)
      return (await readJsonSafe<Detail>(response))!
    }
    const before = await read()
    expect(before.person).toMatchObject({
      displayName: original.displayName,
      primaryEmail: original.primaryEmail,
      primaryPhone: original.primaryPhone,
      description: original.description,
    })
    expect(before.profile).toMatchObject({ firstName: original.firstName, lastName: original.lastName, jobTitle: original.jobTitle })
    expect(typeof before.person.updatedAt).toBe('string')
    const changedName = `${marker} updated`
    const updated = await apiRequest(request, 'PUT', '/api/customers/people', {
      token,
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': before.person.updatedAt! },
      data: { id: personId, displayName: changedName },
    })
    expect(updated.status(), await updated.text()).toBe(200)
    const after = await read()
    expect(after.person).toMatchObject({
      displayName: changedName,
      primaryEmail: original.primaryEmail,
      primaryPhone: original.primaryPhone,
      description: original.description,
    })
    expect(after.profile).toMatchObject({ firstName: original.firstName, lastName: original.lastName, jobTitle: original.jobTitle })
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})

test('TC-CRM-8989: company partial updates and sequential/concurrent reads preserve its fields', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const marker = `tc8989-company-${randomUUID()}`
  const preserved = {
    primaryEmail: `${marker}@example.com`, primaryPhone: '+1 212 555 8989', description: `${marker} description`,
  }
  const profile = { legalName: `${marker} Legal`, websiteUrl: 'https://example.com' }
  let companyId: string | null = null
  type Detail = { company: Record<string, unknown> & { updatedAt?: string }; profile: Record<string, unknown> }
  try {
    const created = await apiRequest(request, 'POST', '/api/customers/companies', {
      token, data: { displayName: marker, ...preserved, ...profile },
    })
    const body = await readJsonSafe<{ id?: string }>(created)
    companyId = typeof body?.id === 'string' ? body.id : null
    expect(created.status(), await created.text()).toBe(201)
    expectId(companyId, 'created company id')
    const read = async () => {
      const response = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
      expect(response.status(), await response.text()).toBe(200)
      return (await readJsonSafe<Detail>(response))!
    }
    const before = await read()
    expect(before.company).toMatchObject({ displayName: marker, ...preserved })
    expect(before.profile).toMatchObject(profile)
    expect(typeof before.company.updatedAt).toBe('string')
    const displayName = `${marker} updated`
    const updated = await apiRequest(request, 'PUT', '/api/customers/companies', {
      token,
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': before.company.updatedAt! },
      data: { id: companyId, displayName },
    })
    expect(updated.status(), await updated.text()).toBe(200)
    const verify = async () => {
      const [detail, response] = await Promise.all([
        read(),
        apiRequest(request, 'GET', `/api/customers/companies?ids=${companyId}&pageSize=100`, { token }),
      ])
      expect(detail.company).toMatchObject({ id: companyId, displayName, ...preserved })
      expect(detail.profile).toMatchObject(profile)
      expect(response.status()).toBe(200)
      const listed = await readJsonSafe<{ items: { id: string }[] }>(response)
      expect(listed?.items.map((item) => item.id)).toEqual([companyId])
    }
    for (let index = 0; index < 10; index += 1) await verify()
    await Promise.all(Array.from({ length: 10 }, verify))
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
