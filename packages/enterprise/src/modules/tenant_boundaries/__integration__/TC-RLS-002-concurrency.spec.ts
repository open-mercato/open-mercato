import { test, expect, type APIRequestContext } from '@playwright/test'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { startRlsLiveRuntime } from './helpers/liveRuntime'
import { createConcurrencyFixtures } from './helpers/concurrencyFixtures'

const peopleSchema = z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) })
type Sample = { user: number; operation: string; status: number | null; latencyMs: number; valid: boolean; isolationViolation: boolean }
type LevelResult = { concurrency: number; distinctUsers: number; tenants: number; peakInFlight: number; elapsedMs: number; p50Ms: number; p95Ms: number; errors: number; isolationViolations: number; retainedRowsUnchanged: boolean; samples: Sample[] }

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((first, second) => first - second)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function analysis(results: LevelResult[]) {
  return [
    '# Authenticated RLS concurrency — actual execution',
    `Recorded: ${new Date().toISOString()}`,
    'Real /api/customers/people requests; 100 persisted non-superadmin staff users split evenly across two disposable tenants. Restricted runtime DB_POOL_MAX=1; simultaneous HTTP requests queue for database access. This is not an adapter off/on benchmark or proof of simultaneous SQL execution.',
    '| Users | Peak HTTP | Requests | p50 ms | p95 ms | Errors | Isolation violations | Rows unchanged |',
    '|---:|---:|---:|---:|---:|---:|---:|---|',
    ...results.map((result) => `| ${result.concurrency} | ${result.peakInFlight} | ${result.samples.length} | ${result.p50Ms.toFixed(2)} | ${result.p95Ms.toFixed(2)} | ${result.errors} | ${result.isolationViolations} | ${result.retainedRowsUnchanged} |`),
    'Latency covers the full HTTP response body; privileged persisted-row verification is excluded. Errors include unexpected status, malformed response, timeout and transport failure. Isolation violations count foreign-read contents, unexpected record IDs in own reads or accepted foreign writes; own deletion/name oracle failures count as errors. No tokens, database URLs or request bodies are included.',
  ].join('\n')
}

test('TC-RLS-002: distinct authenticated users remain isolated at 20/30/50/100 concurrency', async ({ playwright }, testInfo) => {
  test.setTimeout(600_000)
  const runtime = await startRlsLiveRuntime()
  const results: LevelResult[] = []
  let fixtures: Awaited<ReturnType<typeof createConcurrencyFixtures>> | undefined
  try {
    fixtures = await createConcurrencyFixtures(runtime)
    const baseline = await fixtures.retainedRows()
    expect(baseline).toHaveLength(2)
    expect(new Set(fixtures.actors.map((actor) => actor.userId)).size).toBe(100)
    expect(new Set(fixtures.actors.map((actor) => actor.sessionId)).size).toBe(100)
    for (const concurrency of [20, 30, 50, 100]) {
      const actors = fixtures.actors.slice(0, concurrency)
      const contexts: APIRequestContext[] = []
      const samples: Sample[] = []
      const writes = actors.map((actor) => ({ id: '', name: `RLS own ${concurrency} ${actor.userId}` }))
      let inFlight = 0
      let peakInFlight = 0
      const started = performance.now()
      try {
        for (const actor of actors) {
          contexts.push(await playwright.request.newContext({
            baseURL: runtime.baseUrl, extraHTTPHeaders: { Authorization: `Bearer ${actor.token}` }, timeout: 30_000,
          }))
        }
        for (const operation of ['own-read', 'foreign-read', 'foreign-update', 'foreign-delete', 'own-create', 'own-created-read', 'own-update', 'own-updated-read', 'own-delete', 'own-deleted-read']) {
          let release!: () => void
          const barrier = new Promise<void>((resolve) => { release = resolve })
          const pending = actors.map(async (actor, user) => {
            await barrier
            const began = performance.now()
            inFlight += 1
            peakInFlight = Math.max(peakInFlight, inFlight)
            let status: number | null = null
            let valid = false
            let isolationViolation = false
            let httpLatencyMs: number | undefined
            try {
              const context = contexts[user]
              const write = writes[user]
              if (operation.startsWith('own-') && !['own-read', 'own-create'].includes(operation) && !write.id) throw new Error('[internal] Own create did not return a fixture ID')
              const updatedName = `${write.name} updated`
              const response = operation === 'own-create'
                ? await context.post('/api/customers/people', { data: { firstName: write.name, lastName: 'Fixture', displayName: write.name } })
                : operation === 'own-update' || operation === 'foreign-update'
                  ? await context.put('/api/customers/people', { data: { id: operation === 'own-update' ? write.id : actor.foreignCustomerId, displayName: operation === 'own-update' ? updatedName : 'Forbidden concurrency mutation' } })
                  : operation === 'own-delete' || operation === 'foreign-delete'
                    ? await context.delete(`/api/customers/people?id=${operation === 'own-delete' ? write.id : actor.foreignCustomerId}`)
                    : await context.get(`/api/customers/people?id=${operation === 'own-read' ? actor.customerId : operation === 'foreign-read' ? actor.foreignCustomerId : write.id}&pageSize=100`)
              try {
                status = response.status()
                await response.body()
                httpLatencyMs = performance.now() - began
                inFlight -= 1
                if (operation === 'own-create') {
                  const parsed = z.object({ id: z.string().uuid() }).safeParse(await response.json())
                  if (parsed.success) write.id = parsed.data.id
                  valid = status === 201 && parsed.success && await fixtures!.ownRowMatches(write.id, actor, write.name, false)
                } else if (operation.endsWith('read')) {
                  const parsed = peopleSchema.safeParse(await response.json())
                  const absent = operation === 'foreign-read' || operation === 'own-deleted-read'
                  const expectedId = operation === 'own-read' ? actor.customerId : write.id
                  isolationViolation = status === 200 && parsed.success && (operation === 'foreign-read'
                    ? parsed.data.items.length > 0
                    : parsed.data.items.some((item) => item.id !== expectedId))
                  valid = status === 200 && parsed.success && (absent
                    ? parsed.data.items.length === 0
                    : parsed.data.items.length === 1 && parsed.data.items[0].id === expectedId)
                  if (valid && operation.startsWith('own-') && operation !== 'own-read') {
                    valid = await fixtures!.ownRowMatches(write.id, actor, operation === 'own-created-read' ? write.name : updatedName, operation === 'own-deleted-read')
                    if (valid && !absent && parsed.success) valid = parsed.data.items[0].display_name === (operation === 'own-created-read' ? write.name : updatedName)
                  }
                } else {
                  await response.body()
                  isolationViolation = operation.startsWith('foreign-') && response.ok()
                  valid = operation.startsWith('foreign-') ? status === 403 || status === 404
                    : response.ok() && await fixtures!.ownRowMatches(write.id, actor, updatedName, operation === 'own-delete')
                }
              } finally { await response.dispose() }
            } catch { valid = false } finally {
              if (httpLatencyMs === undefined) inFlight -= 1
              samples.push({ user, operation, status, latencyMs: httpLatencyMs ?? performance.now() - began, valid, isolationViolation })
            }
          })
          release()
          await Promise.all(pending)
        }
        const retainedRowsUnchanged = JSON.stringify(await fixtures.retainedRows()) === JSON.stringify(baseline)
        const result: LevelResult = {
          concurrency, distinctUsers: new Set(actors.map((actor) => actor.userId)).size,
          tenants: new Set(actors.map((actor) => actor.tenantId)).size, peakInFlight,
          elapsedMs: performance.now() - started, p50Ms: percentile(samples.map((sample) => sample.latencyMs), 0.5),
          p95Ms: percentile(samples.map((sample) => sample.latencyMs), 0.95),
          errors: samples.filter((sample) => !sample.valid).length,
          isolationViolations: samples.filter((sample) => sample.isolationViolation).length,
          retainedRowsUnchanged, samples,
        }
        results.push(result)
        await testInfo.attach(`rls-concurrency-${concurrency}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
        expect.soft(samples).toHaveLength(concurrency * 10)
        expect.soft(result.distinctUsers).toBe(concurrency)
        expect.soft(result.tenants).toBe(2)
        expect.soft(result.peakInFlight).toBe(concurrency)
        expect.soft(result.errors).toBe(0)
        expect.soft(result.isolationViolations).toBe(0)
        expect.soft(result.retainedRowsUnchanged).toBe(true)
      } finally { await Promise.all(contexts.map((context) => context.dispose())) }
    }
  } finally {
    try {
      await testInfo.attach('rls-concurrency-analysis.md', { body: analysis(results), contentType: 'text/markdown' })
    } finally {
      try { await fixtures?.cleanup() } finally { await runtime.stop() }
    }
  }
})
