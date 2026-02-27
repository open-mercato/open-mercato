# SPEC-045f — Health Monitoring & Marketplace Polish

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 6 of 6

---

## Goal

Implement health check infrastructure with scheduled probing, marketplace search/filtering improvements, and integration usage analytics.

---

## 1. Health Check Infrastructure

### 1.1 Health Service

```typescript
// integrations/lib/health-service.ts

export function createHealthService({ em, integrationCredentials, container }: Dependencies) {
  return {
    async check(integrationId: string, scope: TenantScope): Promise<HealthCheckResult> {
      const definition = getIntegration(integrationId)
      if (!definition?.healthCheck) {
        return { status: 'unconfigured', message: 'No health check configured', checkedAt: new Date().toISOString() }
      }

      const credentials = await integrationCredentials.resolve(integrationId, scope)
      if (!credentials || Object.keys(credentials).length === 0) {
        return { status: 'unconfigured', message: 'No credentials configured', checkedAt: new Date().toISOString() }
      }

      const checker = container.resolve<HealthCheckable>(definition.healthCheck.service)
      const startedAt = Date.now()

      try {
        const result = await Promise.race([
          checker.check(credentials),
          timeout(10_000),  // 10s timeout
        ])
        result.latencyMs = Date.now() - startedAt
        result.checkedAt = new Date().toISOString()

        // Persist result
        await updateHealthState(integrationId, result, scope, em)
        return result
      } catch (err) {
        const result: HealthCheckResult = {
          status: 'unhealthy',
          message: err.message,
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
        }
        await updateHealthState(integrationId, result, scope, em)
        return result
      }
    },
  }
}
```

### 1.2 Periodic Health Check Worker

```typescript
// integrations/workers/health-checker.ts

export const metadata: WorkerMeta = {
  queue: 'integration-health-check',
  id: 'integration-health-checker',
  concurrency: 5,
}

// Scheduled every 15 minutes for enabled integrations with health checks
export default async function handler(job: Job, ctx: WorkerContext) {
  const enabledIntegrations = await ctx.integrationState.listEnabled(job.data.scope)

  for (const integrationId of enabledIntegrations) {
    const definition = getIntegration(integrationId)
    if (!definition?.healthCheck) continue

    await ctx.integrationHealth.check(integrationId, job.data.scope)
  }
}
```

---

## 2. Marketplace Search & Filtering

### 2.1 Search Capabilities

- Full-text search across `title`, `description`, `tags`
- Filter by `category`, `bundleId`, `isEnabled`, `healthStatus`
- Sort by: `title`, `category`, `enabledAt`, `healthStatus`
- Bundle grouping: group integrations by their bundle in the grid view

### 2.2 Usage Analytics

Track per-integration activity counters:
- Last activity timestamp (last event, last sync, last webhook)
- Event counts (30-day rolling window)
- Error rate (errors / total operations)

Displayed as sparklines on marketplace cards and detail pages.

---

## 3. Implementation Steps

1. Implement `health-service.ts` with timeout and state persistence
2. Create scheduled `health-checker` worker (every 15 minutes)
3. Add health status to marketplace card view (healthy/degraded/unhealthy/unconfigured badges)
4. Full-text search on integrations list API
5. Usage analytics counters (derived from `IntegrationLog` aggregation)
6. Integration tests for health check timeout, scheduled checks, search filtering
