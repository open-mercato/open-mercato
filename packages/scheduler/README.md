# @open-mercato/scheduler

Database-managed scheduled jobs with admin UI for Open Mercato.

## Status

**Production Ready** ✅

The scheduler now uses **BullMQ's repeatable jobs** for robust, distributed scheduling.

- [x] Package structure created
- [x] Database entities defined (ScheduledJob, ScheduledJobRun)
- [x] Cron parser implemented (using cron-parser library)
- [x] Interval parser implemented (15m, 2h, 1d formats)
- [x] **BullMQ repeatable jobs integration** (Phase 4 refactoring)
- [x] Execution worker with event emissions
- [x] SchedulerService (public API for modules)
- [x] CLI commands (list, status, run, start)
- [x] History cleanup worker
- [x] ACL features defined
- [x] Full Admin UI (Phase 3)

## Features

### Architecture

**BullMQ-Based Scheduling** (Recommended)

The scheduler uses BullMQ's repeatable jobs for exact timing and distributed locking:

1. **Database as Source of Truth**: Schedules stored in PostgreSQL
2. **BullMQ Manages Timing**: Repeatable jobs trigger at exact times (no polling)
3. **Worker Executes**: `execute-schedule.worker.ts` loads fresh config and enqueues target job
4. **Automatic Sync**: Changes to schedules automatically sync with BullMQ

**Key Components:**

- **Database Entities**: `ScheduledJob` and `ScheduledJobRun` with MikroORM
- **Schedule Parsers**: Cron expressions and simple intervals (15m, 2h, 1d)
- **BullMQSchedulerService**: Syncs database schedules with BullMQ repeatable jobs
- **Execution Worker**: Processes scheduled jobs with feature flag checks
- **SchedulerService**: Public API for modules to register/unregister schedules
- **Event Emissions**: `scheduler.job.started/completed/failed/skipped`
- **History Cleanup**: Automatic 7-day retention worker

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

### Starting the Scheduler (BullMQ)

The scheduler now uses BullMQ repeatable jobs. No need for a separate engine process!

**Setup:**
1. Set `QUEUE_STRATEGY=async` and configure Redis
2. Sync schedules with BullMQ: `yarn mercato scheduler start`
3. Run workers to process jobs: `yarn mercato worker:start`

**How it works:**
- Schedules are stored in database (source of truth)
- BullMQ creates repeatable jobs for each enabled schedule
- Workers execute jobs at scheduled times
- Changes to schedules automatically sync with BullMQ

```bash
# Sync all schedules with BullMQ
yarn mercato scheduler start

# Run workers (in separate process/container)
yarn mercato worker:start
```

**For local development (QUEUE_STRATEGY=local):**
Workers will still process jobs, but scheduling won't be distributed.
Consider using async strategy even in development for full functionality.

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
