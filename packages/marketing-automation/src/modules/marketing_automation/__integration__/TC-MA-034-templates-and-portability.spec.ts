import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

const TEMPLATES_PATH = '/api/marketing_automation/templates'
const IMPORT_PATH = `${CAMPAIGNS_PATH}/import`

type PortableDocument = {
  formatVersion?: number
  name?: string
  definition?: { steps?: Array<{ type?: string }> }
  triggers?: unknown[]
}

/**
 * TC-MA-034: a campaign as a portable document, and the templates built on that format.
 *
 * The property worth pinning is the round trip — an export must be a valid import, because that single fact is
 * what makes templates, backups and moving a campaign between installations one feature instead of three.
 */
test.describe('TC-MA-034 templates and portability', () => {
  test('an exported campaign is a valid import, and comes back the same', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Portable ${Date.now()}`
    const sourceId = await createCampaign(request, token, name)
    let importedId: string | null = null
    try {
      const created = await getCampaign(request, token, sourceId)
      const saved = await saveGraph(request, token, sourceId, {
        updatedAt: created.updatedAt,
        name,
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'orders.count', operator: '>=', value: 1 }] },
          steps: [
            { id: 'wait-a-bit', type: 'wait', params: { minutes: 2880 } },
            { id: 'say-hello', type: 'send_email', params: { subject: 'Hello', bodyHtml: '<p>Hello</p>' } },
          ],
        },
        triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const exported = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${sourceId}/export`, { token })
      expect(exported.ok(), await exported.text()).toBe(true)
      // A file, not a page: the browser saves it rather than rendering it.
      expect(exported.headers()['content-disposition']).toContain('attachment')
      const document = await readJsonSafe<PortableDocument>(exported)

      expect(document?.formatVersion).toBe(1)
      expect(document?.definition?.steps?.map((step) => step.type)).toEqual(['wait', 'send_email'])
      // No identity travels: an export describes intent, not a record.
      expect(JSON.stringify(document)).not.toContain(sourceId)
      expect(JSON.stringify(document)).not.toContain('isEnabled')

      const imported = await apiRequest(request, 'POST', IMPORT_PATH, { token, data: document })
      expect(imported.status(), await imported.text()).toBe(201)
      const body = await readJsonSafe<{ id?: string; warnings?: unknown[] }>(imported)
      importedId = body?.id ?? null
      expect(importedId).toBeTruthy()
      expect(body?.warnings).toEqual([])

      const copy = await getCampaign(request, token, importedId as string)
      expect(copy.definition.steps.map((step) => step.type)).toEqual(['wait', 'send_email'])
      expect(copy.triggers).toHaveLength(1)
      /**
       * DISABLED, whatever the document said — the format does not even carry the flag. An import that could
       * arrive live would mean opening somebody's file starts messaging real customers.
       */
      expect(copy.isEnabled).toBe(false)
    } finally {
      await deleteCampaignIfExists(request, token, sourceId)
      await deleteCampaignIfExists(request, token, importedId)
    }
  })

  test('every shipped template imports, and arrives disabled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const listed = await apiRequest(request, 'GET', TEMPLATES_PATH, { token })
    expect(listed.ok(), await listed.text()).toBe(true)
    const templates = (await readJsonSafe<{ items?: Array<{ id: string; document: unknown }> }>(listed))?.items ?? []
    expect(templates.length).toBeGreaterThan(0)

    for (const template of templates) {
      let createdId: string | null = null
      try {
        const response = await apiRequest(request, 'POST', IMPORT_PATH, { token, data: template.document })
        expect(response.status(), `${template.id}: ${await response.text()}`).toBe(201)
        const body = await readJsonSafe<{ id?: string; warnings?: unknown[] }>(response)
        createdId = body?.id ?? null
        // A shipped template carrying a reference to another installation would be a template that needs
        // fixing before it works, which defeats the point of shipping it.
        expect(body?.warnings, template.id).toEqual([])

        const campaign = await getCampaign(request, token, createdId as string)
        expect(campaign.isEnabled, template.id).toBe(false)
        expect(campaign.definition.steps.length, template.id).toBeGreaterThan(0)
      } finally {
        await deleteCampaignIfExists(request, token, createdId)
      }
    }
  })

  test('a document the save rules would refuse is refused on import too', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', IMPORT_PATH, {
      token,
      data: {
        formatVersion: 1,
        name: `Trailing wait ${Date.now()}`,
        definition: { version: 1, audience: null, steps: [{ id: 'w', type: 'wait', params: { minutes: 1440 } }] },
        triggers: [],
      },
    })
    // The import goes through the ordinary save command, so a campaign ending on a wait — which would park every
    // subject forever — is refused here exactly as it is in the editor.
    expect(response.status()).toBe(400)
  })

  test('a document from a future format version is refused rather than guessed at', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', IMPORT_PATH, {
      token,
      data: { formatVersion: 99, name: 'From the future', definition: { version: 1, audience: null, steps: [] }, triggers: [] },
    })
    expect(response.status()).toBe(400)
  })

  test('an anonymous caller can neither list templates nor import', async ({ request }) => {
    for (const [method, path] of [['GET', TEMPLATES_PATH], ['POST', IMPORT_PATH]] as const) {
      const response = method === 'GET' ? await request.get(path) : await request.post(path, { data: {} })
      expect([401, 403]).toContain(response.status())
    }
  })
})
