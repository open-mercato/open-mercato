import { test } from '@playwright/test'
import { expectNegatedDisplayNameFilter } from './helpers/negatedDisplayName'

export const integrationMeta = { dependsOnModules: ['customers', 'directory', 'entities', 'query_index'] }

test('TC-CRM-8315: does_not_contain filters plaintext company names', async ({ request }) => {
  await expectNegatedDisplayNameFilter(request, 'companies', { encrypted: false })
})
