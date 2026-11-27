import { randomUUID } from 'node:crypto'
import { expect, test as base, type Locator } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

const lists = [
  { title: 'People', resource: 'people' },
  { title: 'Companies', resource: 'companies' },
] as const

async function expectExposed(control: Locator) {
  await expect.poll(() => control.evaluate((element) => {
    const { left, top, width, height } = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(left + width / 2, top + height / 2))
  }), { message: 'The sort control should be reachable at its visible center' }).toBe(true)
}

async function expectHeaderAtScrollportTop(table: Locator, scrollport: Locator) {
  await expect.poll(async () => {
    const header = await table.locator('thead').boundingBox()
    const viewport = await scrollport.boundingBox()
    return header && viewport ? Math.abs(header.y - viewport.y) : Infinity
  }, { message: 'The header should stay at the top of the table scrollport' }).toBeLessThanOrEqual(2)
}

async function expectPinnedEdges(scrollport: Locator, firstColumn: Locator, actionsColumn: Locator) {
  await expect.poll(async () => {
    const { left, right } = await scrollport.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { left: bounds.left + element.clientLeft, right: bounds.left + element.clientLeft + element.clientWidth }
    })
    const first = await firstColumn.boundingBox()
    const actions = await actionsColumn.boundingBox()
    return first && actions ? Math.max(Math.abs(first.x - left), Math.abs(actions.x + actions.width - right)) : Infinity
  }, { message: 'Name and Actions should stay at the left and right scrollport edges' }).toBeLessThanOrEqual(2)
}

type CustomerResource = (typeof lists)[number]['resource']

const test = base.extend<{ resource: CustomerResource; fixturePrefix: string }>({
  resource: ['people', { option: true }],
  fixturePrefix: async ({ request, resource }, providePrefix) => {
    const apiPath = `/api/customers/${resource}`
    const token = await getAuthToken(request, 'admin')
    const prefix = `StickyHeader${randomUUID().slice(0, 8)}`
    const fixtureIds: string[] = []

    try {
      for (let index = 0; index < 20; index += 1) {
        const number = String(index).padStart(2, '0')
        const displayName = `${prefix} ${number}`
        const id = resource === 'people'
          ? await createPersonFixture(request, token, { firstName: prefix, lastName: number, displayName })
          : await createCompanyFixture(request, token, displayName)
        fixtureIds.push(id)
      }
      await providePrefix(prefix)
    } finally {
      const cleanup = await Promise.allSettled(fixtureIds.map(async (id) => {
        const response = await apiRequest(request, 'DELETE', `${apiPath}?id=${encodeURIComponent(id)}`, { token })
        expect(response.ok() || response.status() === 404, `Fixture DELETE returned ${response.status()}`).toBe(true)
      }))
      expect(cleanup.filter((result) => result.status === 'rejected'), 'All CRM fixtures should be deleted').toEqual([])
    }
  },
})

test.use({ viewport: { width: 1000, height: 640 } })

for (const { title, resource } of lists) {
  test.describe(title, () => {
    test.use({ resource })

    test('TC-CRM-8150: keeps headers and sort controls visible while scrolling', async ({ page, fixturePrefix: prefix }) => {
      const apiPath = `/api/customers/${resource}`
      const fixtureNames = new RegExp(`^${prefix} `)
      await login(page, 'admin')
      await page.goto(`/backend/customers/${resource}`)
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible()
      const [filtered] = await Promise.all([
        page.waitForResponse((response) => {
          const url = new URL(response.url())
          return response.request().method() === 'GET' && url.pathname === apiPath && url.searchParams.get('search') === prefix
        }),
        main.getByRole('searchbox', { name: /Search by name, email, phone/ }).fill(prefix),
      ])
      expect(filtered.ok()).toBe(true)

      const table = main.getByRole('table')
      const scrollport = table.locator('..')
      const nameSort = table.getByRole('button', { name: 'Name', exact: true })
      const emailSort = table.getByRole('button', { name: 'Email', exact: true })
      const nameHeader = nameSort.locator('..')
      const actionsHeader = table.getByRole('columnheader', { name: 'Actions', exact: true })
      const fixtureLink = page.getByRole('link', { name: fixtureNames })
      const fixtureRow = table.getByRole('row').filter({ has: fixtureLink }).first()
      await expect(fixtureRow).toBeAttached()

      const verticalOffset = await scrollport.evaluate((element) => {
        element.scrollTop = 160
        return element.scrollTop
      })
      expect(verticalOffset).toBeGreaterThan(100)
      await expectHeaderAtScrollportTop(table, scrollport)
      await expectExposed(nameSort)
      await expectExposed(emailSort)

      const horizontalOffset = await scrollport.evaluate((element) => {
        element.scrollLeft = 85
        return element.scrollLeft
      })
      expect(horizontalOffset).toBeGreaterThan(60)
      await expectHeaderAtScrollportTop(table, scrollport)
      await expectPinnedEdges(scrollport, nameHeader, actionsHeader)
      await expectPinnedEdges(scrollport, fixtureRow.getByRole('cell').filter({ has: fixtureLink }), fixtureRow.getByRole('cell').last())
      await expectExposed(nameSort)

      const [sorted] = await Promise.all([
        page.waitForResponse((response) => {
          const url = new URL(response.url())
          return response.request().method() === 'GET' && url.pathname === apiPath
            && url.searchParams.get('search') === prefix
            && url.searchParams.get('sortField') === 'name' && url.searchParams.get('sortDir') === 'asc'
        }),
        nameSort.click(),
      ])
      expect(sorted.ok()).toBe(true)
      await scrollport.evaluate((element) => { element.scrollTop = 0 })
      await expect(table.getByRole('link', { name: fixtureNames }).first()).toHaveText(`${prefix} 00`)

      await page.setViewportSize({ width: 390, height: 640 })
      await scrollport.evaluate((element) => { element.scrollLeft = 0; element.scrollTop = 160 })
      await expect.poll(() => scrollport.evaluate((element) => element.scrollTop)).toBeGreaterThan(100)
      await expectHeaderAtScrollportTop(table, scrollport)
      await expectExposed(nameSort)
      const narrowNameStart = await nameHeader.evaluate((element) => element.getBoundingClientRect().left)

      await scrollport.evaluate((element) => { element.scrollLeft = 85 })
      await expect.poll(() => nameHeader.evaluate((element) => element.getBoundingClientRect().left))
        .toBeLessThan(narrowNameStart - 60)
      await expectHeaderAtScrollportTop(table, scrollport)
      await expectExposed(emailSort)
    })
  })
}
