import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

type QueryRows<T> = { rows: T[] }

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(process.cwd(), 'apps/mercato', '.env') })
}

function isAlwaysConsistentEnabled(): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    (process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT ?? '').trim().toLowerCase(),
  )
}

/**
 * Regression for PR #3236 UI QA. This fault-injection scenario targets the
 * opt-in failure contract and therefore only runs when the app and test runner
 * are started with OM_CACHE_SAFETY_ALWAYS_CONSISTENT=on.
 */
test.describe('TC-EXAMPLE-002: always-consistent index failures stay loud and singular', () => {
  test.skip(!isAlwaysConsistentEnabled(), 'Requires OM_CACHE_SAFETY_ALWAYS_CONSISTENT=on')

  test('shows one failed save and records exactly one indexer error', async ({ page, request }) => {
    test.slow()
    if (process.env.OM_INTEGRATION_TEST !== 'true') {
      throw new Error('TC-EXAMPLE-002 must run through the managed ephemeral integration runner')
    }
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for TC-EXAMPLE-002 fault injection')
    }

    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const title = `QA forced index failure ${suffix}`
    const functionName = `qa_fail_search_tokens_${suffix}`
    const triggerName = `qa_fail_search_tokens_${suffix}`
    const db = new Client({ connectionString })
    let todoId: string | null = null
    let triggerInstalled = false
    await db.connect()

    try {
      await db.query(`
        create function "${functionName}"() returns trigger language plpgsql as $$
        begin
          if new.entity_type = 'example:todo'
             and exists (select 1 from todos where id::text = new.entity_id and title = '${title}') then
            raise exception 'TC-EXAMPLE-002 forced search_tokens failure';
          end if;
          return new;
        end;
        $$;
        create trigger "${triggerName}"
          before insert on search_tokens
          for each row execute function "${functionName}"();
      `)
      triggerInstalled = true

      await login(page, 'admin')
      await page.goto('/backend/todos/create', { waitUntil: 'commit' })

      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      const priorityInput = page.locator('[data-crud-field-id="cf_priority"] input[type="number"]').first()
      const severitySelect = page.locator('[data-crud-field-id="cf_severity"]').getByRole('combobox').first()
      await expect(titleInput).toBeVisible()
      await titleInput.fill(title)
      await priorityInput.fill('3')
      await severitySelect.click()
      await page.getByRole('option', { name: 'Medium' }).click()

      const form = titleInput.locator('xpath=ancestor::form').first()
      const failedResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/example/todos') && response.request().method() === 'POST',
      )
      await form.locator('button[type="submit"]').first().click()
      const failedResponse = await failedResponsePromise

      expect(failedResponse.status()).toBe(500)
      await expect(page).toHaveURL(/\/backend\/todos\/create(?:\?.*)?$/)
      await expect(form.locator('.text-status-error-text').first()).toBeVisible()
      await expect(page.getByText('Todo created', { exact: true })).toHaveCount(0)

      const todoRow = await db.query(
        'select id::text from todos where title = $1',
        [title],
      ) as QueryRows<{ id: string }>
      todoId = todoRow.rows[0]?.id ?? null
      expect(todoId, 'the command write should be identifiable for cleanup').toBeTruthy()

      const indexedRows = await db.query(
        `select count(*)::text as count from entity_indexes
         where entity_type = 'example:todo' and entity_id = $1`,
        [todoId],
      ) as QueryRows<{ count: string }>
      const tokenRows = await db.query(
        `select count(*)::text as count from search_tokens
         where entity_type = 'example:todo' and entity_id = $1`,
        [todoId],
      ) as QueryRows<{ count: string }>
      expect(Number(indexedRows.rows[0]?.count ?? 0)).toBe(0)
      expect(Number(tokenRows.rows[0]?.count ?? 0)).toBe(0)

      const errorRows = await db.query(
        `select count(*)::text as count from indexer_error_logs
         where source = 'query_index' and entity_type = 'example:todo' and record_id = $1`,
        [todoId],
      ) as QueryRows<{ count: string }>
      expect(Number(errorRows.rows[0]?.count ?? 0)).toBe(1)

      const searchParams = new URLSearchParams({
        q: suffix,
        limit: '10',
        strategies: 'tokens',
        entityTypes: 'example:todo',
      })
      const searchResponse = await apiRequest(
        request,
        'GET',
        `/api/search/search?${searchParams.toString()}`,
        { token },
      )
      expect(searchResponse.ok()).toBeTruthy()
      const searchBody = await searchResponse.json() as {
        results?: Array<{ entityId?: unknown; recordId?: unknown }>
      }
      expect(
        (searchBody.results ?? []).some(
          (result) => result.entityId === 'example:todo' && result.recordId === todoId,
        ),
      ).toBe(false)
    } finally {
      if (triggerInstalled) {
        await db.query(`drop trigger if exists "${triggerName}" on search_tokens`).catch(() => undefined)
      }
      await db.query(`drop function if exists "${functionName}"()`).catch(() => undefined)
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
      if (todoId) {
        await db.query(
          `delete from indexer_error_logs
           where source = 'query_index' and entity_type = 'example:todo' and record_id = $1`,
          [todoId],
        ).catch(() => undefined)
      }
      await db.end().catch(() => undefined)
    }
  })
})
