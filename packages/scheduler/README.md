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

The scheduler supports two strategies to fit your deployment needs:

#### 1. **Async Strategy** (Production - Recommended)

Uses BullMQ repeatable jobs for exact timing and distributed locking:

- **Database as Source of Truth**: Schedules stored in PostgreSQL
- **BullMQ Manages Timing**: Repeatable jobs trigger at exact times (no polling delay)
- **Worker Executes**: `execute-schedule.worker.ts` loads fresh config and enqueues target job
- **Distributed**: Multiple instances can run safely with Redis-backed locking
- **Automatic Sync**: Changes to schedules automatically sync with BullMQ

**Requirements:**
- Redis (for BullMQ)
- `QUEUE_STRATEGY=async`

**Benefits:**
- Exact timing (no polling delay)
- Distributed locking across multiple instances
- Lower database load
- Production-grade reliability

#### 2. **Local Strategy** (Development)

Uses PostgreSQL polling for simple local development:

- **Database Polling**: Checks for due schedules every 30s (configurable)
- **PostgreSQL Advisory Locks**: Prevents duplicate execution in single instance
- **Direct Execution**: `LocalSchedulerService` enqueues jobs directly
- **No Redis Required**: Perfect for local development

**Requirements:**
- PostgreSQL only
- `QUEUE_STRATEGY=local` (default)

**Benefits:**
- No Redis dependency
- Simpler setup for local dev
- Identical events and history logging

**Drawbacks:**
- Polling delay (up to 30s)
- Higher database load
- Single instance only
- No distributed locking

### Key Components

- **Database Entities**: `ScheduledJob` and `ScheduledJobRun` with MikroORM
- **Schedule Parsers**: Cron expressions and simple intervals (15m, 2h, 1d)
- **BullMQSchedulerService**: Syncs database schedules with BullMQ repeatable jobs (async strategy)
- **LocalSchedulerService**: Polling-based scheduler for local development (local strategy)
- **Execution Worker**: Processes scheduled jobs with feature flag checks (async strategy)
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

The scheduler supports two target types:
- **Queue-based**: Enqueues a job to a queue worker
- **Command-based**: Executes a registered command directly

#### Queue-Based Schedule Example

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

#### Command-Based Schedule Example

```typescript
import { SchedulerService } from '@open-mercato/scheduler'

export class ReportingService {
  constructor(private schedulerService: SchedulerService) {}

  async enableDailyReports(config: ReportConfig) {
    await this.schedulerService.register({
      id: `reports:daily:${config.organizationId}`,
      name: 'Generate Daily Reports',
      scopeType: 'organization',
      organizationId: config.organizationId,
      tenantId: config.tenantId,
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *', // Every day at 9 AM
      targetType: 'command',
      targetCommand: 'reports.generate.daily', // Must be a registered command
      targetPayload: { 
        reportType: 'daily',
        recipients: config.recipients 
      },
      sourceModule: 'reports',
    })
  }
}
```

**Important**: When using `targetType: 'command'`:
- The command must be registered via `registerCommand()` before creating the schedule
- Validation will fail if the command doesn't exist
- Commands run with full tenant/organization scope but without user authentication

### Starting the Scheduler

#### Async Strategy (Production)

Uses BullMQ repeatable jobs - no separate scheduler process needed!

**Setup:**
1. Set `QUEUE_STRATEGY=async` in `.env`
2. Configure Redis: `REDIS_URL=redis://localhost:6379`
3. Sync schedules with BullMQ: `yarn mercato scheduler start`
4. Run workers: `yarn mercato worker:start`

```bash
# Sync all schedules with BullMQ (one-time or after schedule changes)
yarn mercato scheduler start

# Run workers to process scheduled jobs (keep running)
yarn mercato worker:start
```

**How it works:**
- Schedules stored in database (source of truth)
- BullMQ creates repeatable jobs for each enabled schedule
- Workers execute jobs at exact scheduled times
- Changes to schedules automatically sync with BullMQ

#### Local Strategy (Development)

Uses PostgreSQL polling - requires running scheduler process!

**Setup:**
1. Set `QUEUE_STRATEGY=local` in `.env` (or omit, it's the default)
2. Start the scheduler: `yarn mercato scheduler start`

```bash
# Start the local polling engine (keep running)
yarn mercato scheduler start
```

**How it works:**
- Scheduler polls database every 30s for due schedules
- Uses PostgreSQL advisory locks to prevent duplicate execution
- Enqueues jobs directly to target queues
- Press Ctrl+C to stop

**Note:** The local strategy is perfect for development but not recommended for production. Use the async strategy for production deployments.

## Environment Variables

```bash
# Queue strategy (determines scheduler behavior)
QUEUE_STRATEGY=local|async         # Default: local

# Local strategy configuration
SCHEDULER_POLL_INTERVAL_MS=30000   # Poll interval in ms (default: 30s)

# Async strategy configuration (requires Redis)
REDIS_URL=redis://localhost:6379   # Redis connection URL
QUEUE_REDIS_URL=redis://...        # Alternative Redis URL for queues
```

### Strategy Comparison

| Feature | Local Strategy | Async Strategy |
|---------|---------------|----------------|
| **Redis Required** | ❌ No | ✅ Yes |
| **Setup Complexity** | Low | Medium |
| **Timing Accuracy** | ~30s delay | Exact (cron-precision) |
| **Database Load** | Higher (polling) | Lower (event-driven) |
| **Distributed** | ❌ Single instance | ✅ Multi-instance safe |
| **Use Case** | Local dev | Production |
| **Process** | `scheduler start` (keep running) | `scheduler start` (one-time sync) + workers |

## Next Steps

- **Phase 2**: API & Commands (CRUD routes, validators, commands with undo)
- **Phase 3**: Admin UI (DataTable, CrudForm, detail pages)
- **Phase 4**: Advanced features (CLI, history cleanup worker)
- **Phase 5**: Currency integration example
- **Phase 6**: Testing & documentation

## License

MIT
