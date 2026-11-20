import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  captureShowcase, eligibleFixtureScope, field, policyApi, readReadyShowcasePolicy, saveShowcase,
  showcaseHeaders, test, type TodoRecord,
} from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example'] }

function versionForBrand(todo: TodoRecord): string {
  const version = todo._extensions?.example?.__updatedAt
  if (typeof version === 'string') return version
  if (version && typeof version === 'object') {
    const match = Object.entries(version).find(([id, value]) => id.includes('.brand.sink-') && typeof value === 'string')
    if (match) return String(match[1])
  }
  throw new Error('[internal] Expected a versioned brand')
}

test('TC-EXAMPLE-FORM-007 persists and freshens both versions, and rolls back a rejected table write', async ({ page, request, showcaseTodo }) => {
  test.slow()
  const policy = await readReadyShowcasePolicy(page, showcaseTodo.open)
  const brand = field(page, 'brand').getByRole('textbox')
  const rejectedBrand = `reject-${randomUUID()}`
  const refresh = () => page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.searchParams.get('id') === showcaseTodo.id
      && url.searchParams.get('sectionDetail') === 'showcase'
  })
  await brand.fill('First brand')
  const refreshedFirst = refresh()
  expect((await saveShowcase(page)).status()).toBe(200)
  expect((await refreshedFirst).status()).toBe(200)
  const first = await showcaseTodo.read()
  expect(first._extensions?.example?.brand).toBe('First brand')
  const oldVersion = versionForBrand(first)

  await expect(brand).toHaveValue('First brand')
  await brand.fill('Second brand')
  const refreshedSecond = refresh()
  expect((await saveShowcase(page)).status()).toBe(200)
  expect((await refreshedSecond).status()).toBe(200)
  const saved = await showcaseTodo.read()
  expect(saved.updatedAt).not.toBe(first.updatedAt)
  expect(versionForBrand(saved)).not.toBe(oldVersion)
  expect(saved._extensions?.example?.brand).toBe('Second brand')
  await expect(brand).toHaveValue('Second brand')
  await brand.scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c7-saved-brand')

  const currentVersions = saved._extensions?.example?.__updatedAt
  const brandKey = typeof currentVersions === 'object' && currentVersions
    ? Object.keys(currentVersions).find((key) => key.includes('.brand.sink-')) : undefined
  const staleToken = brandKey ? { [brandKey]: oldVersion } : oldVersion
  const refused = await apiRequest(request, 'PUT', policyApi, {
    token: showcaseTodo.token, headers: showcaseHeaders(policy, saved.id, saved.updatedAt),
    data: { id: saved.id, is_done: true, extensions: { example: { brand: 'Old version', __updatedAt: staleToken } } },
  })
  expect(refused.status()).toBe(409)
  expect(await refused.json()).toMatchObject({ code: OPTIMISTIC_LOCK_CONFLICT_CODE })
  expect(await showcaseTodo.read()).toMatchObject({ updatedAt: saved.updatedAt, is_done: false, _extensions: saved._extensions })

  const scope = eligibleFixtureScope(saved)
  const fault = 'qa_brand_' + randomUUID().replace(/-/g, '')
  await withClient(async (client) => {
    await client.query(`create function ${fault}() returns trigger language plpgsql as $$
      begin
        if new.host_id = '${scope[0]}'::uuid and new.tenant_id = '${scope[1]}'::uuid
          and new.organization_id = '${scope[2]}'::uuid and new.brand = '${rejectedBrand}' then
          raise exception 'fixture brand write rejected';
        end if;
        return new;
      end;
    $$`)
    try {
      await client.query(`create trigger ${fault} before insert or update on example_todo_brands for each row execute function ${fault}()`)
      const auditCount = async () => (await client.query<{ count: string }>(
        "select count(*) as count from action_logs where resource_id = $1 and tenant_id = $2 and organization_id = $3 and resource_kind = 'example.todo'", scope,
      )).rows[0].count
      const before = await auditCount()
      await brand.fill(rejectedBrand)
      await field(page, 'is_done').getByRole('checkbox').check()
      await field(page, 'cf_priority').getByRole('textbox', { name: 'Priority level' }).fill('4')
      const failure = await saveShowcase(page)
      expect(failure.status()).toBe(500)
      expect(await auditCount()).toBe(before)
      const after = await showcaseTodo.read()
      expect(after).toMatchObject({ updatedAt: saved.updatedAt, is_done: false, cf_priority: saved.cf_priority, _extensions: saved._extensions })
      await brand.scrollIntoViewIfNeeded()
      await captureShowcase(page, 'c7-rolled-back-brand')
    } finally {
      await client.query(`drop trigger if exists ${fault} on example_todo_brands`)
      await client.query(`drop function if exists ${fault}()`)
    }
  })
})
