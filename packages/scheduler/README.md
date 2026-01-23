# @open-mercato/scheduler

Database-managed scheduled jobs with admin UI for Open Mercato.

## Status

**Phase 1 Complete: Core Infrastructure** ✅

- [x] Package structure created
- [x] Database entities defined (ScheduledJob, ScheduledJobRun)
- [x] Cron parser implemented (using cron-parser library)
- [x] Interval parser implemented (15m, 2h, 1d formats)
- [x] Next run calculator implemented
- [x] Scheduler engine with locking strategies
- [x] SchedulerService (public API for modules)
- [x] ACL features defined

## Features

### Completed

- **Database Entities**: `ScheduledJob` and `ScheduledJobRun` with MikroORM
- **Schedule Parsers**: 
  - Cron expressions (e.g., `*/30 * * * *`)
  - Simple intervals (e.g., `15m`, `2h`, `1d`)
- **Scheduler Engine**: Polls database, acquires locks, enqueues jobs
- **Locking Strategies**:
  - Local: PostgreSQL advisory locks (single-instance)
  - Async: Redis distributed locks (multi-instance) - stub for now
- **SchedulerService**: Public API for modules to register/unregister schedules
- **Event Emissions**: `scheduler.job.started/completed/failed/skipped`

### Scope Types

- `system`: Global platform tasks (no tenant/org)
- `organization`: Org-specific tasks (requires both tenant + org ID)
- `tenant`: Tenant-wide tasks (requires only tenant ID)

## Installation

```bash
npm install @open-mercato/scheduler
```

## Usage

### Registering a Schedule (Module Integration)

```typescript
import { SchedulerService } from '@open-mercato/scheduler'

// In your module's setup service
export class CurrencySetupService {
  constructor(private schedulerService: SchedulerService) {}

  async enableAutoFetch(config: CurrencyFetchConfig) {
    await this.schedulerService.register({
      id: `currencies:fetch-rates:${config.organizationId}`,
      name: 'Fetch Currency Rates',
      scopeType: 'organization',
      organizationId: config.organizationId,
      tenantId: config.tenantId,
      scheduleType: 'cron',
      scheduleValue: '0 */6 * * *', // Every 6 hours
      targetType: 'queue',
      targetQueue: 'currency-rates',
      targetPayload: { providers: config.providers },
      sourceModule: 'currencies',
    })
  }

  async disableAutoFetch(organizationId: string) {
    await this.schedulerService.unregister(
      `currencies:fetch-rates:${organizationId}`
    )
  }
}
```

### Starting the Scheduler Engine

```typescript
import { SchedulerEngine } from '@open-mercato/scheduler'
import { createEventBus } from '@open-mercato/events'
import { createQueue } from '@open-mercato/queue'

const engine = new SchedulerEngine(
  () => em, // EntityManager factory
  eventBus,
  (queueName) => createQueue(queueName, 'local'),
  rbacService,
  {
    strategy: 'local', // or 'async' for Redis
    pollIntervalMs: 30000, // 30 seconds
  }
)

await engine.start()
```

## Environment Variables

```bash
# Scheduler strategy
SCHEDULER_STRATEGY=local|async  # Default: local

# Engine configuration
SCHEDULER_ENABLED=true          # Default: true
SCHEDULER_POLL_INTERVAL_MS=30000  # Default: 30 seconds
SCHEDULER_LOCK_TIMEOUT_MS=60000   # Default: 1 minute

# Redis (for async strategy)
REDIS_URL=redis://localhost:6379
```

## Next Steps

- **Phase 2**: API & Commands (CRUD routes, validators, commands with undo)
- **Phase 3**: Admin UI (DataTable, CrudForm, detail pages)
- **Phase 4**: Advanced features (CLI, history cleanup worker)
- **Phase 5**: Currency integration example
- **Phase 6**: Testing & documentation

## License

MIT
