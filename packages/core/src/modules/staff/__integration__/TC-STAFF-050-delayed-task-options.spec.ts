import { expect, test } from '@playwright/test'
import { assertBoardDirectoryAccess, assertTaskDraft, boardCopy, prepareBoardScenario, enterTaskDraft, openBoard, saveAndReopenTask } from './helpers/taskBoard'

export const integrationMeta = { dependsOnModules: ['auth', 'customers'] }

for (const persona of ['manager', 'employee'] as const) {
  const locale = persona === 'manager' ? 'en' : 'pl'
  test.describe(`TC-STAFF-050: ${persona} types before delayed status options`, () => {
    const run = prepareBoardScenario(persona)
    test('retains the draft through delayed options and scope settlement', async ({ page }, testInfo) => run(page, testInfo, async ({ page, fixture, baseURL }) => {
      const surface = await openBoard(page, fixture, locale, baseURL, { coldScope: true, holdStatuses: true })
      try {
        const copy = boardCopy(locale)
        const title = `Delayed options ${fixture.projectId.slice(0, 8)}`
        const dialog = await enterTaskDraft(page, locale, title)
        await expect(dialog.getByRole('button', { name: copy.create, exact: true })).toBeDisabled()
        await surface.releaseStatusOptions()
        await assertTaskDraft(page, locale, title, 'Ready A')
        await expect(dialog.getByRole('button', { name: copy.create, exact: true })).toBeEnabled()
        expect(surface.statusRequests).toBe(1)
        await surface.releaseScope()
        expect(surface.statusRequests).toBe(2)
        await assertTaskDraft(page, locale, title, 'Ready A')
        await saveAndReopenTask(page, fixture, locale, title, fixture.defaultStatusId, 'Ready A')
        await assertBoardDirectoryAccess(page, surface, persona)
      } finally {
        await surface.dispose()
      }
    }))
  })
}
