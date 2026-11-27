import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import { deleteEntityByPathIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

type DictionaryDetails = {
  key: string
  name: string
  isActive: boolean
  isSystem: boolean
  updatedAt: string
}

test('TC-DICT-014: system dictionary metadata can be edited while its identity stays protected', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const key = `qa_system_dictionary_${suffix}`
  const name = `QA system dictionary ${suffix}`
  const updatedName = `${name} updated`
  const dictionaryId = await createDictionaryFixture(request, token, { key, name })
  const apiPath = `/api/dictionaries/${dictionaryId}`

  try {
    await withClient((client) => client.query('update dictionaries set is_system = true where id = $1', [dictionaryId]))

    await login(page, 'admin')
    await page.goto('/backend/config/dictionaries')
    const row = page.getByRole('listitem').filter({ hasText: key })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: '', exact: true }).first().click()

    const dialog = page.getByRole('dialog', { name: 'Edit dictionary' })
    const keyField = dialog.getByPlaceholder('slug_name')
    await expect(keyField).toBeDisabled()
    await expect(keyField).toHaveValue(key)
    await dialog.getByPlaceholder('Display name').fill(updatedName)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText(updatedName)

    const detail = await apiRequest(request, 'GET', apiPath, { token })
    expect(detail.status()).toBe(200)
    const dictionary = await readJsonSafe<DictionaryDetails>(detail)
    expect(dictionary).toMatchObject({ key, name: updatedName, isActive: true, isSystem: true })
    expect(dictionary?.updatedAt).toEqual(expect.any(String))
    const headers = { [OPTIMISTIC_LOCK_HEADER_NAME]: dictionary?.updatedAt ?? '' }

    const renameKey = await apiRequest(request, 'PATCH', apiPath, {
      token, headers, data: { key: `${key}_changed` },
    })
    expect(renameKey.status()).toBe(400)
    const disable = await apiRequest(request, 'PATCH', apiPath, {
      token, headers, data: { isActive: false },
    })
    expect(disable.status()).toBe(400)
    const remove = await apiRequest(request, 'DELETE', apiPath, { token, headers })
    expect(remove.status()).toBe(400)

    const finalDetail = await apiRequest(request, 'GET', apiPath, { token })
    expect(finalDetail.status()).toBe(200)
    expect(await readJsonSafe<DictionaryDetails>(finalDetail)).toMatchObject({
      key, name: updatedName, isActive: true, isSystem: true,
    })
  } finally {
    await withClient((client) => client.query('update dictionaries set is_system = false where id = $1', [dictionaryId]))
    await deleteEntityByPathIfExists(request, token, apiPath)
  }
})
