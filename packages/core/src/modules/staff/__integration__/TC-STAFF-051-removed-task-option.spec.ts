import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { assertBoardDirectoryAccess, assertTaskDraft, prepareBoardScenario, enterTaskDraft, openBoard, saveAndReopenTask } from './helpers/taskBoard'
import { STATUSES_PATH } from './helpers/taskBoardFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'customers'] }

for (const persona of ['manager', 'employee'] as const) {
  const locale = persona === 'manager' ? 'en' : 'pl'
  test.describe(`TC-STAFF-051: ${persona} falls back after the selected real status is removed`, () => {
    const run = prepareBoardScenario(persona)
    test('preserves the title and saves the surviving default', async ({ page }, testInfo) => run(page, testInfo, async ({ page, fixture, baseURL }) => {
      const surface = await openBoard(page, fixture, locale, baseURL, { coldScope: true })
      try {
        const title = `Removed option ${fixture.projectId.slice(0, 8)}`
        await enterTaskDraft(page, locale, title, 'Working A')
        const statuses = await apiRequest(fixture.request, 'GET', `${STATUSES_PATH}?timeProjectId=${fixture.projectId}&pageSize=100`, { token: fixture.adminToken })
        expect(statuses.status()).toBe(200)
        const body = await readJsonSafe<{ items: Array<{ id: string; updated_at?: string; updatedAt?: string }> }>(statuses)
        const status = body?.items.find((item) => item.id === fixture.chosenStatusId)
        const updatedAt = status?.updatedAt ?? status?.updated_at
        expect(typeof updatedAt, 'The real deletion must use the selected status version').toBe('string')
        if (!updatedAt) throw new Error('[internal] fixture status version unavailable')
        expect(Number.isFinite(Date.parse(updatedAt))).toBe(true)
        const deletion = await apiRequest(fixture.request, 'DELETE', `${STATUSES_PATH}?id=${fixture.chosenStatusId}`, {
          token: fixture.adminToken, headers: buildOptimisticLockHeader(updatedAt),
        })
        expect(deletion.status()).toBe(200)
        await surface.releaseScope()
        await assertTaskDraft(page, locale, title, 'Ready A')
        await saveAndReopenTask(page, fixture, locale, title, fixture.defaultStatusId, 'Ready A')
        await assertBoardDirectoryAccess(page, surface, persona)
      } finally {
        await surface.dispose()
      }
    }))
  })
}
