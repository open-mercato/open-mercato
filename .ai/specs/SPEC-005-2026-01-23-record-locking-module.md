# Record Locking Module Specification

## Overview

The Record Locking module provides optimistic and pessimistic locking mechanisms for records being edited, with conflict detection, resolution UI, and merge capabilities. It prevents data loss when multiple users edit the same record simultaneously.

**Key Features:**
- **Pessimistic Locking** - Completely blocks other users from editing a locked record
- **Optimistic Locking** - Allows concurrent edits but detects conflicts on save
- **Auto-release** - Locks automatically expire after configurable timeout
- **Force Unlock** - Admins can forcibly release locks
- **Conflict Resolution UI** - Side-by-side diff view with merge options
- **Notifications** - Both users notified of conflicts and merge results

**Package Location:** `packages/core/src/modules/record_locks/`

### Update Note (2026-02-17)

Minimal correction aligned with version-history changes from #479:
- Conflict handling should reuse snapshots already stored in `action_logs` as the source of truth.
- `record_lock_conflicts` should keep lightweight references (`base_action_log_id`, `incoming_action_log_id`) instead of duplicating full snapshots in the lock module.
- Current conflict resolution UI scope in implementation is simplified to `accept incoming` and `keep my changes`; legacy merge flow described below is treated as out of current MVP scope.

---

## Use Cases

| ID | Actor | Use Case | Description | Priority |
|----|-------|----------|-------------|----------|
| RL1 | User | Acquire lock | User opens record for editing, lock is acquired | High |
| RL2 | User | Release lock | User closes form or saves, lock is released | High |
| RL3 | System | Auto-release lock | Lock expires after timeout | High |
| RL4 | Admin | Force unlock | Admin releases another user's lock | High |
| RL5 | User | View lock status | User sees who is editing the record | High |
| RL6 | User | Blocked from editing | In pessimistic mode, user cannot edit locked record | High |
| RL7 | User | Detect conflict | In optimistic mode, conflict detected on save | High |
| RL8 | User | Accept incoming | User discards their changes, accepts other's version | High |
| RL9 | User | Accept mine | User overwrites with their changes (creates new version) | High |
| RL10 | User | Combine changes | User opens merge UI to manually combine changes | High |
| RL11 | User | View diff | User sees side-by-side comparison of versions | High |
| RL12 | User | Receive notification | User notified when their edit conflicts or is merged | High |
| RL13 | Admin | Configure mode | Admin sets optimistic/pessimistic mode globally | Medium |
| RL14 | Admin | Configure timeout | Admin sets lock timeout duration | Medium |
| RL15 | User | Extend lock | User activity extends the lock timeout | Medium |
| RL16 | User | Request lock release | User requests current editor to release lock | Low |

---

## Configuration

### Environment Variables

```bash
# Default lock timeout in seconds (default: 300 = 5 minutes)
RECORD_LOCK_TIMEOUT_SECONDS=300

# Lock heartbeat interval in seconds (default: 30)
RECORD_LOCK_HEARTBEAT_SECONDS=30

# Default locking strategy: 'optimistic' or 'pessimistic' (default: optimistic)
RECORD_LOCK_STRATEGY=optimistic
```

### App Config (UI Configurable)

```typescript
// packages/core/src/modules/record_locks/lib/config.ts
import { z } from 'zod'

export const recordLockConfigSchema = z.object({
  // Locking strategy
  strategy: z.enum(['optimistic', 'pessimistic']).default('optimistic'),
  
  // Lock timeout in seconds
  timeoutSeconds: z.number().min(60).max(3600).default(300),
  
  // Heartbeat interval in seconds
  heartbeatSeconds: z.number().min(10).max(120).default(30),
  
  // Allow users to request lock release
  allowLockRequests: z.boolean().default(true),
  
  // Auto-merge trivial conflicts (non-overlapping field changes)
  autoMergeTrivial: z.boolean().default(false),
  
  // Entities excluded from locking (by entity ID)
  excludedEntities: z.array(z.string()).default([]),
  
  // Features requiring lock (if empty, all CRUD forms use locking)
  enabledEntities: z.array(z.string()).optional(),
})

export type RecordLockConfig = z.infer<typeof recordLockConfigSchema>

export const DEFAULT_CONFIG: RecordLockConfig = {
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  allowLockRequests: true,
  autoMergeTrivial: false,
  excludedEntities: [],
}
```

### Config Registration

```typescript
// packages/core/src/modules/record_locks/config-section.ts
import type { ConfigSection } from '@open-mercato/shared/lib/config/types'
import { recordLockConfigSchema } from './lib/config'

export const configSection: ConfigSection = {
  id: 'record_locks',
  labelKey: 'recordLocks.config.title',
  icon: 'lock',
  schema: recordLockConfigSchema,
  defaultValue: {
    strategy: 'optimistic',
    timeoutSeconds: 300,
    heartbeatSeconds: 30,
    allowLockRequests: true,
    autoMergeTrivial: false,
    excludedEntities: [],
  },
}
```

---

## Database Schema

### Entity: `RecordLock`

**Table:** `record_locks`

```typescript
// packages/core/src/modules/record_locks/data/entities.ts
import { Entity, PrimaryKey, Property, Index, OptionalProps, Unique } from '@mikro-orm/core'

export type LockStatus = 'active' | 'expired' | 'released' | 'force_released'

@Entity({ tableName: 'record_locks' })
@Unique({ name: 'record_locks_entity_record_unique', properties: ['entityType', 'recordId', 'tenantId'] })
@Index({ name: 'record_locks_user_idx', properties: ['lockedByUserId', 'status'] })
@Index({ name: 'record_locks_expires_idx', properties: ['expiresAt', 'status'] })
export class RecordLock {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  // What is locked
  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string // e.g., 'customers:person', 'sales:order'

  @Property({ name: 'record_id', type: 'uuid' })
  recordId!: string

  // Who locked it
  @Property({ name: 'locked_by_user_id', type: 'uuid' })
  lockedByUserId!: string

  // Lock timing
  @Property({ name: 'locked_at', type: Date })
  lockedAt!: Date

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'last_heartbeat_at', type: Date })
  lastHeartbeatAt!: Date

  // Status
  @Property({ name: 'status', type: 'text' })
  status: LockStatus = 'active'

  @Property({ name: 'released_at', type: Date, nullable: true })
  releasedAt?: Date | null

  @Property({ name: 'released_by_user_id', type: 'uuid', nullable: true })
  releasedByUserId?: string | null

  @Property({ name: 'release_reason', type: 'text', nullable: true })
  releaseReason?: string | null // 'saved', 'cancelled', 'expired', 'force', 'conflict_resolved'

  // Snapshot of record at lock time (for conflict detection)
  @Property({ name: 'initial_snapshot', type: 'json', nullable: true })
  initialSnapshot?: Record<string, unknown> | null

  // Version number for optimistic locking
  @Property({ name: 'version', type: 'int', default: 1 })
  version: number = 1

  // Multi-tenant
  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

### Entity: `RecordConflict`

**Table:** `record_conflicts`

Records conflict events for audit and resolution tracking.

```typescript
export type ConflictStatus = 'pending' | 'resolved_accept_incoming' | 'resolved_accept_mine' | 'resolved_merged' | 'auto_merged'
export type ConflictResolution = 'accept_incoming' | 'accept_mine' | 'merged'

@Entity({ tableName: 'record_conflicts' })
@Index({ name: 'record_conflicts_entity_idx', properties: ['entityType', 'recordId'] })
@Index({ name: 'record_conflicts_users_idx', properties: ['originalUserId', 'conflictingUserId'] })
@Index({ name: 'record_conflicts_status_idx', properties: ['status', 'createdAt'] })
export class RecordConflict {
  [OptionalProps]?: 'status' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  // What had conflict
  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'record_id', type: 'uuid' })
  recordId!: string

  // Users involved
  @Property({ name: 'original_user_id', type: 'uuid' })
  originalUserId!: string // User who saved first

  @Property({ name: 'conflicting_user_id', type: 'uuid' })
  conflictingUserId!: string // User who got the conflict

  // Snapshots for comparison
  @Property({ name: 'base_snapshot', type: 'json' })
  baseSnapshot!: Record<string, unknown> // Original state when both started editing

  @Property({ name: 'incoming_snapshot', type: 'json' })
  incomingSnapshot!: Record<string, unknown> // What was saved by originalUser

  @Property({ name: 'conflicting_snapshot', type: 'json' })
  conflictingSnapshot!: Record<string, unknown> // What conflictingUser tried to save

  // Diff analysis
  @Property({ name: 'incoming_changes', type: 'json' })
  incomingChanges!: FieldChange[] // Changes from base -> incoming

  @Property({ name: 'conflicting_changes', type: 'json' })
  conflictingChanges!: FieldChange[] // Changes from base -> conflicting

  @Property({ name: 'overlapping_fields', type: 'json' })
  overlappingFields!: string[] // Fields changed by both users

  // Resolution
  @Property({ name: 'status', type: 'text' })
  status: ConflictStatus = 'pending'

  @Property({ name: 'resolution', type: 'text', nullable: true })
  resolution?: ConflictResolution | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null

  @Property({ name: 'merged_snapshot', type: 'json', nullable: true })
  mergedSnapshot?: Record<string, unknown> | null // Final merged result

  @Property({ name: 'merge_decisions', type: 'json', nullable: true })
  mergeDecisions?: MergeDecision[] | null // Per-field decisions made

  // Multi-tenant
  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

// Field change tracking
export type FieldChange = {
  field: string
  path: string // JSONPath for nested fields
  oldValue: unknown
  newValue: unknown
  type: 'added' | 'modified' | 'removed'
}

// Merge decision per field
export type MergeDecision = {
  field: string
  path: string
  decision: 'accept_incoming' | 'accept_mine' | 'custom'
  customValue?: unknown
  decidedAt: string // ISO date
}
```

### SQL Migration

```sql
-- packages/core/src/modules/record_locks/migrations/Migration_CreateRecordLocks.ts

-- Record locks table
CREATE TABLE record_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What is locked
  entity_type TEXT NOT NULL,
  record_id UUID NOT NULL,
  
  -- Who locked
  locked_by_user_id UUID NOT NULL,
  
  -- Timing
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active',
  released_at TIMESTAMPTZ,
  released_by_user_id UUID,
  release_reason TEXT,
  
  -- Snapshot for conflict detection
  initial_snapshot JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  
  -- Multi-tenant
  tenant_id UUID NOT NULL,
  organization_id UUID,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(entity_type, record_id, tenant_id) -- Only one active lock per record
);

CREATE INDEX record_locks_user_idx ON record_locks(locked_by_user_id, status);
CREATE INDEX record_locks_expires_idx ON record_locks(expires_at, status) WHERE status = 'active';

-- Conflict tracking table
CREATE TABLE record_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What had conflict
  entity_type TEXT NOT NULL,
  record_id UUID NOT NULL,
  
  -- Users involved
  original_user_id UUID NOT NULL,
  conflicting_user_id UUID NOT NULL,
  
  -- Snapshots
  base_snapshot JSONB NOT NULL,
  incoming_snapshot JSONB NOT NULL,
  conflicting_snapshot JSONB NOT NULL,
  
  -- Diff analysis
  incoming_changes JSONB NOT NULL DEFAULT '[]',
  conflicting_changes JSONB NOT NULL DEFAULT '[]',
  overlapping_fields JSONB NOT NULL DEFAULT '[]',
  
  -- Resolution
  status TEXT NOT NULL DEFAULT 'pending',
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id UUID,
  merged_snapshot JSONB,
  merge_decisions JSONB,
  
  -- Multi-tenant
  tenant_id UUID NOT NULL,
  organization_id UUID,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX record_conflicts_entity_idx ON record_conflicts(entity_type, record_id);
CREATE INDEX record_conflicts_users_idx ON record_conflicts(original_user_id, conflicting_user_id);
CREATE INDEX record_conflicts_status_idx ON record_conflicts(status, created_at);
```

---

## Locking Service

### Lock Management

```typescript
// packages/core/src/modules/record_locks/lib/lockService.ts
import type { EntityManager } from '@mikro-orm/core'
import type { EventBus } from '@open-mercato/events'
import { RecordLock, RecordConflict } from '../data/entities'
import { getRecordLockConfig } from './config'
import { computeFieldChanges, findOverlappingFields } from './diff'

export type AcquireLockResult = 
  | { success: true; lock: RecordLock }
  | { success: false; reason: 'already_locked'; lockedBy: { userId: string; userName?: string; lockedAt: Date; expiresAt: Date } }
  | { success: false; reason: 'excluded_entity' }

export type SaveResult =
  | { success: true; saved: true }
  | { success: false; reason: 'conflict'; conflict: RecordConflict }
  | { success: false; reason: 'lock_expired' }
  | { success: false; reason: 'not_locked' }

export interface RecordLockService {
  /**
   * Acquire a lock on a record for editing
   */
  acquireLock(params: {
    entityType: string
    recordId: string
    userId: string
    initialSnapshot: Record<string, unknown>
    tenantId: string
    organizationId?: string | null
  }): Promise<AcquireLockResult>

  /**
   * Release a lock (on save or cancel)
   */
  releaseLock(params: {
    entityType: string
    recordId: string
    userId: string
    reason: 'saved' | 'cancelled' | 'conflict_resolved'
    tenantId: string
  }): Promise<void>

  /**
   * Force release a lock (admin only)
   */
  forceReleaseLock(params: {
    entityType: string
    recordId: string
    adminUserId: string
    tenantId: string
  }): Promise<void>

  /**
   * Send heartbeat to keep lock alive
   */
  heartbeat(params: {
    entityType: string
    recordId: string
    userId: string
    tenantId: string
  }): Promise<{ extended: boolean; expiresAt: Date }>

  /**
   * Check lock status for a record
   */
  getLockStatus(params: {
    entityType: string
    recordId: string
    tenantId: string
  }): Promise<{ locked: boolean; lock?: RecordLock; lockedByUser?: { id: string; name?: string } }>

  /**
   * Validate save (check for conflicts in optimistic mode)
   */
  validateSave(params: {
    entityType: string
    recordId: string
    userId: string
    currentSnapshot: Record<string, unknown>
    newData: Record<string, unknown>
    tenantId: string
    organizationId?: string | null
  }): Promise<SaveResult>

  /**
   * Get pending conflicts for a user
   */
  getPendingConflicts(params: {
    userId: string
    tenantId: string
  }): Promise<RecordConflict[]>

  /**
   * Resolve a conflict
   */
  resolveConflict(params: {
    conflictId: string
    resolution: 'accept_incoming' | 'accept_mine' | 'merged'
    mergedData?: Record<string, unknown>
    mergeDecisions?: MergeDecision[]
    userId: string
    tenantId: string
  }): Promise<{ success: boolean; savedData: Record<string, unknown> }>

  /**
   * Cleanup expired locks
   */
  cleanupExpiredLocks(): Promise<number>
}

export function createRecordLockService(
  em: EntityManager,
  eventBus: EventBus,
): RecordLockService {
  
  async function acquireLock(params: {
    entityType: string
    recordId: string
    userId: string
    initialSnapshot: Record<string, unknown>
    tenantId: string
    organizationId?: string | null
  }): Promise<AcquireLockResult> {
    const config = await getRecordLockConfig(params.tenantId)
    
    // Check if entity is excluded
    if (config.excludedEntities.includes(params.entityType)) {
      return { success: false, reason: 'excluded_entity' }
    }
    
    // Check for existing active lock
    const existingLock = await em.findOne(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      tenantId: params.tenantId,
      status: 'active',
      expiresAt: { $gt: new Date() },
    })
    
    if (existingLock) {
      // Same user can re-acquire
      if (existingLock.lockedByUserId === params.userId) {
        existingLock.lastHeartbeatAt = new Date()
        existingLock.expiresAt = new Date(Date.now() + config.timeoutSeconds * 1000)
        await em.flush()
        return { success: true, lock: existingLock }
      }
      
      // Different user - locked
      return {
        success: false,
        reason: 'already_locked',
        lockedBy: {
          userId: existingLock.lockedByUserId,
          lockedAt: existingLock.lockedAt,
          expiresAt: existingLock.expiresAt,
        },
      }
    }
    
    // Expire any stale locks
    await em.nativeUpdate(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      tenantId: params.tenantId,
      status: 'active',
      expiresAt: { $lte: new Date() },
    }, {
      status: 'expired',
      releasedAt: new Date(),
      releaseReason: 'expired',
    })
    
    // Create new lock
    const now = new Date()
    const lock = em.create(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      lockedByUserId: params.userId,
      lockedAt: now,
      expiresAt: new Date(now.getTime() + config.timeoutSeconds * 1000),
      lastHeartbeatAt: now,
      status: 'active',
      initialSnapshot: params.initialSnapshot,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
    })
    
    await em.persistAndFlush(lock)
    
    await eventBus.emit('record_locks.acquired', {
      lockId: lock.id,
      entityType: params.entityType,
      recordId: params.recordId,
      userId: params.userId,
      tenantId: params.tenantId,
    })
    
    return { success: true, lock }
  }
  
  async function releaseLock(params: {
    entityType: string
    recordId: string
    userId: string
    reason: 'saved' | 'cancelled' | 'conflict_resolved'
    tenantId: string
  }): Promise<void> {
    const lock = await em.findOne(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      lockedByUserId: params.userId,
      tenantId: params.tenantId,
      status: 'active',
    })
    
    if (lock) {
      lock.status = 'released'
      lock.releasedAt = new Date()
      lock.releasedByUserId = params.userId
      lock.releaseReason = params.reason
      await em.flush()
      
      await eventBus.emit('record_locks.released', {
        lockId: lock.id,
        entityType: params.entityType,
        recordId: params.recordId,
        userId: params.userId,
        reason: params.reason,
        tenantId: params.tenantId,
      })
    }
  }
  
  async function forceReleaseLock(params: {
    entityType: string
    recordId: string
    adminUserId: string
    tenantId: string
  }): Promise<void> {
    const lock = await em.findOne(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      tenantId: params.tenantId,
      status: 'active',
    })
    
    if (lock) {
      const originalUserId = lock.lockedByUserId
      
      lock.status = 'force_released'
      lock.releasedAt = new Date()
      lock.releasedByUserId = params.adminUserId
      lock.releaseReason = 'force'
      await em.flush()
      
      // Notify the user whose lock was released
      await eventBus.emit('record_locks.force_released', {
        lockId: lock.id,
        entityType: params.entityType,
        recordId: params.recordId,
        originalUserId,
        adminUserId: params.adminUserId,
        tenantId: params.tenantId,
      }, { persistent: true })
    }
  }
  
  async function heartbeat(params: {
    entityType: string
    recordId: string
    userId: string
    tenantId: string
  }): Promise<{ extended: boolean; expiresAt: Date }> {
    const config = await getRecordLockConfig(params.tenantId)
    
    const lock = await em.findOne(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      lockedByUserId: params.userId,
      tenantId: params.tenantId,
      status: 'active',
    })
    
    if (!lock) {
      return { extended: false, expiresAt: new Date() }
    }
    
    lock.lastHeartbeatAt = new Date()
    lock.expiresAt = new Date(Date.now() + config.timeoutSeconds * 1000)
    await em.flush()
    
    return { extended: true, expiresAt: lock.expiresAt }
  }
  
  async function getLockStatus(params: {
    entityType: string
    recordId: string
    tenantId: string
  }): Promise<{ locked: boolean; lock?: RecordLock; lockedByUser?: { id: string; name?: string } }> {
    const lock = await em.findOne(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      tenantId: params.tenantId,
      status: 'active',
      expiresAt: { $gt: new Date() },
    })
    
    if (!lock) {
      return { locked: false }
    }
    
    // TODO: Fetch user name from user service
    return {
      locked: true,
      lock,
      lockedByUser: { id: lock.lockedByUserId },
    }
  }
  
  async function validateSave(params: {
    entityType: string
    recordId: string
    userId: string
    currentSnapshot: Record<string, unknown>
    newData: Record<string, unknown>
    tenantId: string
    organizationId?: string | null
  }): Promise<SaveResult> {
    const config = await getRecordLockConfig(params.tenantId)
    
    // In pessimistic mode, lock must be active
    if (config.strategy === 'pessimistic') {
      const lock = await em.findOne(RecordLock, {
        entityType: params.entityType,
        recordId: params.recordId,
        lockedByUserId: params.userId,
        tenantId: params.tenantId,
        status: 'active',
        expiresAt: { $gt: new Date() },
      })
      
      if (!lock) {
        return { success: false, reason: 'not_locked' }
      }
      
      return { success: true, saved: true }
    }
    
    // Optimistic mode - check for version conflicts
    const lock = await em.findOne(RecordLock, {
      entityType: params.entityType,
      recordId: params.recordId,
      lockedByUserId: params.userId,
      tenantId: params.tenantId,
    })
    
    // Check if record was modified since we started editing
    const baseSnapshot = lock?.initialSnapshot || params.currentSnapshot
    
    // Get the actual current state from the database
    // This requires entity-specific fetch - simplified here
    const actualCurrentState = params.currentSnapshot
    
    // Compare base snapshot with actual current state
    const incomingChanges = computeFieldChanges(baseSnapshot, actualCurrentState)
    
    if (incomingChanges.length === 0) {
      // No changes by others - safe to save
      return { success: true, saved: true }
    }
    
    // There were changes - compute our changes
    const myChanges = computeFieldChanges(baseSnapshot, params.newData)
    const overlappingFields = findOverlappingFields(incomingChanges, myChanges)
    
    // If no overlapping fields and autoMergeTrivial is enabled
    if (overlappingFields.length === 0 && config.autoMergeTrivial) {
      // Auto-merge: apply both changes
      const mergedData = { ...actualCurrentState, ...params.newData }
      // Record the auto-merge
      const conflict = em.create(RecordConflict, {
        entityType: params.entityType,
        recordId: params.recordId,
        originalUserId: lock?.lockedByUserId || params.userId,
        conflictingUserId: params.userId,
        baseSnapshot,
        incomingSnapshot: actualCurrentState,
        conflictingSnapshot: params.newData,
        incomingChanges,
        conflictingChanges: myChanges,
        overlappingFields: [],
        status: 'auto_merged',
        resolution: 'merged',
        resolvedAt: new Date(),
        resolvedByUserId: params.userId,
        mergedSnapshot: mergedData,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
      })
      await em.persistAndFlush(conflict)
      
      return { success: true, saved: true }
    }
    
    // Create conflict record
    const conflict = em.create(RecordConflict, {
      entityType: params.entityType,
      recordId: params.recordId,
      originalUserId: lock?.lockedByUserId || params.userId,
      conflictingUserId: params.userId,
      baseSnapshot,
      incomingSnapshot: actualCurrentState,
      conflictingSnapshot: params.newData,
      incomingChanges,
      conflictingChanges: myChanges,
      overlappingFields,
      status: 'pending',
      tenantId: params.tenantId,
      organizationId: params.organizationId,
    })
    
    await em.persistAndFlush(conflict)
    
    // Notify both users
    await eventBus.emit('record_locks.conflict_detected', {
      conflictId: conflict.id,
      entityType: params.entityType,
      recordId: params.recordId,
      originalUserId: conflict.originalUserId,
      conflictingUserId: conflict.conflictingUserId,
      overlappingFields,
      tenantId: params.tenantId,
    }, { persistent: true })
    
    return { success: false, reason: 'conflict', conflict }
  }
  
  async function getPendingConflicts(params: {
    userId: string
    tenantId: string
  }): Promise<RecordConflict[]> {
    return em.find(RecordConflict, {
      conflictingUserId: params.userId,
      tenantId: params.tenantId,
      status: 'pending',
    }, {
      orderBy: { createdAt: 'DESC' },
    })
  }
  
  async function resolveConflict(params: {
    conflictId: string
    resolution: 'accept_incoming' | 'accept_mine' | 'merged'
    mergedData?: Record<string, unknown>
    mergeDecisions?: MergeDecision[]
    userId: string
    tenantId: string
  }): Promise<{ success: boolean; savedData: Record<string, unknown> }> {
    const conflict = await em.findOne(RecordConflict, {
      id: params.conflictId,
      tenantId: params.tenantId,
      status: 'pending',
    })
    
    if (!conflict) {
      throw new Error('Conflict not found or already resolved')
    }
    
    let savedData: Record<string, unknown>
    
    switch (params.resolution) {
      case 'accept_incoming':
        savedData = conflict.incomingSnapshot
        conflict.status = 'resolved_accept_incoming'
        break
        
      case 'accept_mine':
        savedData = conflict.conflictingSnapshot
        conflict.status = 'resolved_accept_mine'
        break
        
      case 'merged':
        if (!params.mergedData) {
          throw new Error('mergedData required for merge resolution')
        }
        savedData = params.mergedData
        conflict.status = 'resolved_merged'
        conflict.mergedSnapshot = params.mergedData
        conflict.mergeDecisions = params.mergeDecisions || null
        break
        
      default:
        throw new Error('Invalid resolution')
    }
    
    conflict.resolution = params.resolution
    conflict.resolvedAt = new Date()
    conflict.resolvedByUserId = params.userId
    
    await em.flush()
    
    // Notify both users of resolution
    await eventBus.emit('record_locks.conflict_resolved', {
      conflictId: conflict.id,
      entityType: conflict.entityType,
      recordId: conflict.recordId,
      resolution: params.resolution,
      originalUserId: conflict.originalUserId,
      conflictingUserId: conflict.conflictingUserId,
      resolvedByUserId: params.userId,
      tenantId: params.tenantId,
    }, { persistent: true })
    
    return { success: true, savedData }
  }
  
  async function cleanupExpiredLocks(): Promise<number> {
    const result = await em.nativeUpdate(RecordLock, {
      status: 'active',
      expiresAt: { $lte: new Date() },
    }, {
      status: 'expired',
      releasedAt: new Date(),
      releaseReason: 'expired',
    })
    
    return result as number
  }
  
  return {
    acquireLock,
    releaseLock,
    forceReleaseLock,
    heartbeat,
    getLockStatus,
    validateSave,
    getPendingConflicts,
    resolveConflict,
    cleanupExpiredLocks,
  }
}
```

### Diff Utilities

```typescript
// packages/core/src/modules/record_locks/lib/diff.ts
import type { FieldChange } from '../data/entities'

/**
 * Compute field-level changes between two snapshots
 */
export function computeFieldChanges(
  base: Record<string, unknown>,
  current: Record<string, unknown>,
  prefix: string = ''
): FieldChange[] {
  const changes: FieldChange[] = []
  const allKeys = new Set([...Object.keys(base), ...Object.keys(current)])
  
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key
    const oldValue = base[key]
    const newValue = current[key]
    
    if (oldValue === undefined && newValue !== undefined) {
      changes.push({ field: key, path, oldValue: undefined, newValue, type: 'added' })
    } else if (oldValue !== undefined && newValue === undefined) {
      changes.push({ field: key, path, oldValue, newValue: undefined, type: 'removed' })
    } else if (!deepEqual(oldValue, newValue)) {
      if (isObject(oldValue) && isObject(newValue)) {
        // Recurse for nested objects
        changes.push(...computeFieldChanges(oldValue as Record<string, unknown>, newValue as Record<string, unknown>, path))
      } else {
        changes.push({ field: key, path, oldValue, newValue, type: 'modified' })
      }
    }
  }
  
  return changes
}

/**
 * Find fields that were changed by both users
 */
export function findOverlappingFields(
  incomingChanges: FieldChange[],
  conflictingChanges: FieldChange[],
): string[] {
  const incomingPaths = new Set(incomingChanges.map(c => c.path))
  return conflictingChanges
    .filter(c => incomingPaths.has(c.path))
    .map(c => c.path)
}

/**
 * Apply merge decisions to create final data
 */
export function applyMergeDecisions(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  mine: Record<string, unknown>,
  decisions: Array<{ path: string; decision: 'accept_incoming' | 'accept_mine' | 'custom'; customValue?: unknown }>
): Record<string, unknown> {
  // Start with incoming as base (it was saved first)
  const result = JSON.parse(JSON.stringify(incoming)) as Record<string, unknown>
  
  for (const decision of decisions) {
    switch (decision.decision) {
      case 'accept_mine':
        setValueAtPath(result, decision.path, getValueAtPath(mine, decision.path))
        break
      case 'accept_incoming':
        // Already in result
        break
      case 'custom':
        setValueAtPath(result, decision.path, decision.customValue)
        break
    }
  }
  
  return result
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every(k => deepEqual((a as any)[k], (b as any)[k]))
  }
  return false
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: any, key) => acc?.[key], obj)
}

function setValueAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  const last = parts.pop()!
  const target = parts.reduce((acc: any, key) => {
    if (!acc[key]) acc[key] = {}
    return acc[key]
  }, obj)
  target[last] = value
}
```

---

## API Endpoints

### Route: `/api/record-locks/acquire`

```typescript
// packages/core/src/modules/record_locks/api/acquire/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'
import { z } from 'zod'

const acquireSchema = z.object({
  entityType: z.string().min(1),
  recordId: z.string().uuid(),
  initialSnapshot: z.record(z.unknown()),
})

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const userId = ctx.auth?.sub!
  const tenantId = ctx.auth?.tenantId!
  const organizationId = ctx.selectedOrganizationId
  
  const body = await req.json()
  const input = acquireSchema.parse(body)
  
  const result = await lockService.acquireLock({
    entityType: input.entityType,
    recordId: input.recordId,
    userId,
    initialSnapshot: input.initialSnapshot,
    tenantId,
    organizationId,
  })
  
  if (result.success) {
    return json({
      acquired: true,
      lock: {
        id: result.lock.id,
        expiresAt: result.lock.expiresAt,
        version: result.lock.version,
      },
    })
  }
  
  if (result.reason === 'already_locked') {
    // Fetch user name
    const userService = ctx.container.resolve('userService') as any
    const lockedByUser = await userService.findById(result.lockedBy.userId)
    
    return json({
      acquired: false,
      reason: 'already_locked',
      lockedBy: {
        userId: result.lockedBy.userId,
        userName: lockedByUser?.name || 'Unknown User',
        lockedAt: result.lockedBy.lockedAt,
        expiresAt: result.lockedBy.expiresAt,
      },
    }, { status: 409 })
  }
  
  return json({
    acquired: false,
    reason: result.reason,
  }, { status: 400 })
}

export const metadata = {
  POST: { requireAuth: true },
}
```

### Route: `/api/record-locks/release`

```typescript
// packages/core/src/modules/record_locks/api/release/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'
import { z } from 'zod'

const releaseSchema = z.object({
  entityType: z.string().min(1),
  recordId: z.string().uuid(),
  reason: z.enum(['saved', 'cancelled', 'conflict_resolved']),
})

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const userId = ctx.auth?.sub!
  const tenantId = ctx.auth?.tenantId!
  
  const body = await req.json()
  const input = releaseSchema.parse(body)
  
  await lockService.releaseLock({
    entityType: input.entityType,
    recordId: input.recordId,
    userId,
    reason: input.reason,
    tenantId,
  })
  
  return json({ released: true })
}

export const metadata = {
  POST: { requireAuth: true },
}
```

### Route: `/api/record-locks/force-release`

```typescript
// packages/core/src/modules/record_locks/api/force-release/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'
import { z } from 'zod'

const forceReleaseSchema = z.object({
  entityType: z.string().min(1),
  recordId: z.string().uuid(),
})

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const adminUserId = ctx.auth?.sub!
  const tenantId = ctx.auth?.tenantId!
  
  const body = await req.json()
  const input = forceReleaseSchema.parse(body)
  
  await lockService.forceReleaseLock({
    entityType: input.entityType,
    recordId: input.recordId,
    adminUserId,
    tenantId,
  })
  
  return json({ released: true })
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['record_locks.manage'] },
}
```

### Route: `/api/record-locks/heartbeat`

```typescript
// packages/core/src/modules/record_locks/api/heartbeat/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'
import { z } from 'zod'

const heartbeatSchema = z.object({
  entityType: z.string().min(1),
  recordId: z.string().uuid(),
})

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const userId = ctx.auth?.sub!
  const tenantId = ctx.auth?.tenantId!
  
  const body = await req.json()
  const input = heartbeatSchema.parse(body)
  
  const result = await lockService.heartbeat({
    entityType: input.entityType,
    recordId: input.recordId,
    userId,
    tenantId,
  })
  
  return json(result)
}

export const metadata = {
  POST: { requireAuth: true },
}
```

### Route: `/api/record-locks/status`

```typescript
// packages/core/src/modules/record_locks/api/status/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'
import { z } from 'zod'

const statusQuerySchema = z.object({
  entityType: z.string().min(1),
  recordId: z.string().uuid(),
})

export async function GET(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const tenantId = ctx.auth?.tenantId!
  
  const url = new URL(req.url)
  const input = statusQuerySchema.parse(Object.fromEntries(url.searchParams))
  
  const result = await lockService.getLockStatus({
    entityType: input.entityType,
    recordId: input.recordId,
    tenantId,
  })
  
  if (result.locked && result.lock) {
    const userService = ctx.container.resolve('userService') as any
    const lockedByUser = await userService.findById(result.lock.lockedByUserId)
    
    return json({
      locked: true,
      lockedBy: {
        userId: result.lock.lockedByUserId,
        userName: lockedByUser?.name || 'Unknown User',
        lockedAt: result.lock.lockedAt,
        expiresAt: result.lock.expiresAt,
      },
      isMyLock: result.lock.lockedByUserId === ctx.auth?.sub,
    })
  }
  
  return json({ locked: false })
}

export const metadata = {
  GET: { requireAuth: true },
}
```

### Route: `/api/record-locks/validate-save`

```typescript
// packages/core/src/modules/record_locks/api/validate-save/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'
import { z } from 'zod'

const validateSaveSchema = z.object({
  entityType: z.string().min(1),
  recordId: z.string().uuid(),
  currentSnapshot: z.record(z.unknown()),
  newData: z.record(z.unknown()),
})

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const userId = ctx.auth?.sub!
  const tenantId = ctx.auth?.tenantId!
  const organizationId = ctx.selectedOrganizationId
  
  const body = await req.json()
  const input = validateSaveSchema.parse(body)
  
  const result = await lockService.validateSave({
    entityType: input.entityType,
    recordId: input.recordId,
    userId,
    currentSnapshot: input.currentSnapshot,
    newData: input.newData,
    tenantId,
    organizationId,
  })
  
  if (result.success) {
    return json({ valid: true })
  }
  
  if (result.reason === 'conflict') {
    return json({
      valid: false,
      reason: 'conflict',
      conflict: {
        id: result.conflict.id,
        baseSnapshot: result.conflict.baseSnapshot,
        incomingSnapshot: result.conflict.incomingSnapshot,
        conflictingSnapshot: result.conflict.conflictingSnapshot,
        incomingChanges: result.conflict.incomingChanges,
        conflictingChanges: result.conflict.conflictingChanges,
        overlappingFields: result.conflict.overlappingFields,
      },
    }, { status: 409 })
  }
  
  return json({
    valid: false,
    reason: result.reason,
  }, { status: 400 })
}

export const metadata = {
  POST: { requireAuth: true },
}
```

### Route: `/api/record-locks/conflicts`

```typescript
// packages/core/src/modules/record_locks/api/conflicts/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'

export async function GET(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const userId = ctx.auth?.sub!
  const tenantId = ctx.auth?.tenantId!
  
  const conflicts = await lockService.getPendingConflicts({
    userId,
    tenantId,
  })
  
  return json({ conflicts })
}

export const metadata = {
  GET: { requireAuth: true },
}
```

### Route: `/api/record-locks/conflicts/[id]/resolve`

```typescript
// packages/core/src/modules/record_locks/api/conflicts/[id]/resolve/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { json } from '@open-mercato/shared/lib/api/response'
import { z } from 'zod'

const resolveSchema = z.object({
  resolution: z.enum(['accept_incoming', 'accept_mine', 'merged']),
  mergedData: z.record(z.unknown()).optional(),
  mergeDecisions: z.array(z.object({
    path: z.string(),
    decision: z.enum(['accept_incoming', 'accept_mine', 'custom']),
    customValue: z.unknown().optional(),
  })).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx } = await resolveRequestContext(req)
  const lockService = ctx.container.resolve('recordLockService')
  const userId = ctx.auth?.sub!
  const tenantId = ctx.auth?.tenantId!
  
  const body = await req.json()
  const input = resolveSchema.parse(body)
  
  const result = await lockService.resolveConflict({
    conflictId: params.id,
    resolution: input.resolution,
    mergedData: input.mergedData,
    mergeDecisions: input.mergeDecisions?.map(d => ({
      ...d,
      field: d.path.split('.').pop() || d.path,
      decidedAt: new Date().toISOString(),
    })),
    userId,
    tenantId,
  })
  
  return json(result)
}

export const metadata = {
  POST: { requireAuth: true },
}
```

---

## UI Components

### Lock Status Banner

```typescript
// packages/core/src/modules/record_locks/components/LockStatusBanner.tsx
'use client'

import * as React from 'react'
import { Lock, Unlock, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatDistanceToNow } from 'date-fns'

export type LockStatusBannerProps = {
  entityType: string
  recordId: string
  initialSnapshot: Record<string, unknown>
  onLockAcquired?: (lockId: string, expiresAt: Date) => void
  onLockDenied?: (lockedBy: { userId: string; userName: string; expiresAt: Date }) => void
  onLockReleased?: () => void
  onForceRelease?: () => void
  canForceRelease?: boolean // Admin permission
  strategy: 'optimistic' | 'pessimistic'
}

export function LockStatusBanner({
  entityType,
  recordId,
  initialSnapshot,
  onLockAcquired,
  onLockDenied,
  onLockReleased,
  onForceRelease,
  canForceRelease = false,
  strategy,
}: LockStatusBannerProps) {
  const t = useT()
  const [lockStatus, setLockStatus] = React.useState<{
    locked: boolean
    isMyLock?: boolean
    lockedBy?: { userId: string; userName: string; lockedAt: Date; expiresAt: Date }
    expiresAt?: Date
  } | null>(null)
  const [acquiring, setAcquiring] = React.useState(false)
  const heartbeatRef = React.useRef<NodeJS.Timeout | null>(null)
  
  // Acquire lock on mount
  React.useEffect(() => {
    acquireLock()
    
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
      }
      // Release lock on unmount
      releaseLock('cancelled')
    }
  }, [entityType, recordId])
  
  async function acquireLock() {
    setAcquiring(true)
    try {
      const result = await apiCall<{
        acquired: boolean
        lock?: { id: string; expiresAt: string }
        lockedBy?: { userId: string; userName: string; lockedAt: string; expiresAt: string }
      }>('/api/record-locks/acquire', {
        method: 'POST',
        body: JSON.stringify({ entityType, recordId, initialSnapshot }),
      })
      
      if (result.ok && result.result?.acquired) {
        setLockStatus({
          locked: true,
          isMyLock: true,
          expiresAt: new Date(result.result.lock!.expiresAt),
        })
        onLockAcquired?.(result.result.lock!.id, new Date(result.result.lock!.expiresAt))
        
        // Start heartbeat
        startHeartbeat()
      } else if (result.result?.lockedBy) {
        setLockStatus({
          locked: true,
          isMyLock: false,
          lockedBy: {
            ...result.result.lockedBy,
            lockedAt: new Date(result.result.lockedBy.lockedAt),
            expiresAt: new Date(result.result.lockedBy.expiresAt),
          },
        })
        onLockDenied?.(result.result.lockedBy as any)
      }
    } catch (error) {
      console.error('Failed to acquire lock:', error)
    } finally {
      setAcquiring(false)
    }
  }
  
  function startHeartbeat() {
    // Heartbeat every 30 seconds
    heartbeatRef.current = setInterval(async () => {
      try {
        const result = await apiCall<{ extended: boolean; expiresAt: string }>(
          '/api/record-locks/heartbeat',
          {
            method: 'POST',
            body: JSON.stringify({ entityType, recordId }),
          }
        )
        
        if (result.ok && result.result?.extended) {
          setLockStatus(prev => prev ? {
            ...prev,
            expiresAt: new Date(result.result!.expiresAt),
          } : null)
        }
      } catch (error) {
        console.error('Heartbeat failed:', error)
      }
    }, 30000)
  }
  
  async function releaseLock(reason: 'saved' | 'cancelled') {
    try {
      await apiCall('/api/record-locks/release', {
        method: 'POST',
        body: JSON.stringify({ entityType, recordId, reason }),
      })
      onLockReleased?.()
    } catch (error) {
      console.error('Failed to release lock:', error)
    }
  }
  
  async function handleForceRelease() {
    if (!confirm(t('recordLocks.confirmForceRelease'))) return
    
    try {
      await apiCall('/api/record-locks/force-release', {
        method: 'POST',
        body: JSON.stringify({ entityType, recordId }),
      })
      flash(t('recordLocks.lockForceReleased'), 'success')
      onForceRelease?.()
      // Try to acquire the lock now
      await acquireLock()
    } catch (error) {
      flash(t('recordLocks.forceReleaseFailed'), 'error')
    }
  }
  
  if (acquiring) {
    return (
      <Alert className="mb-4">
        <Clock className="h-4 w-4 animate-spin" />
        <AlertTitle>{t('recordLocks.acquiringLock')}</AlertTitle>
      </Alert>
    )
  }
  
  if (!lockStatus) return null
  
  // I have the lock
  if (lockStatus.isMyLock) {
    return (
      <Alert className="mb-4 border-green-200 bg-green-50">
        <Lock className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-800">{t('recordLocks.youHaveLock')}</AlertTitle>
        <AlertDescription className="text-green-700">
          {t('recordLocks.lockExpiresIn', {
            time: formatDistanceToNow(lockStatus.expiresAt!),
          })}
        </AlertDescription>
      </Alert>
    )
  }
  
  // Someone else has the lock
  if (strategy === 'pessimistic') {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t('recordLocks.recordLocked')}</AlertTitle>
        <AlertDescription>
          {t('recordLocks.lockedByUser', {
            userName: lockStatus.lockedBy?.userName,
            time: formatDistanceToNow(lockStatus.lockedBy!.lockedAt, { addSuffix: true }),
          })}
          {lockStatus.lockedBy?.expiresAt && (
            <span className="block mt-1 text-sm">
              {t('recordLocks.lockExpiresIn', {
                time: formatDistanceToNow(lockStatus.lockedBy.expiresAt),
              })}
            </span>
          )}
        </AlertDescription>
        {canForceRelease && (
          <Button
            variant="destructive"
            size="sm"
            className="mt-2"
            onClick={handleForceRelease}
          >
            <Unlock className="mr-1 h-4 w-4" />
            {t('recordLocks.forceRelease')}
          </Button>
        )}
      </Alert>
    )
  }
  
  // Optimistic mode - show warning but allow editing
  return (
    <Alert className="mb-4 border-amber-200 bg-amber-50">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800">{t('recordLocks.beingEdited')}</AlertTitle>
      <AlertDescription className="text-amber-700">
        {t('recordLocks.beingEditedByUser', {
          userName: lockStatus.lockedBy?.userName,
        })}
        <span className="block mt-1 text-sm">
          {t('recordLocks.conflictMayOccur')}
        </span>
      </AlertDescription>
    </Alert>
  )
}
```

### Conflict Resolution Dialog

```typescript
// packages/core/src/modules/record_locks/components/ConflictResolutionDialog.tsx
'use client'

import * as React from 'react'
import { AlertTriangle, Check, X, GitMerge, ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FieldChange } from '../data/entities'

export type ConflictData = {
  id: string
  baseSnapshot: Record<string, unknown>
  incomingSnapshot: Record<string, unknown>
  conflictingSnapshot: Record<string, unknown>
  incomingChanges: FieldChange[]
  conflictingChanges: FieldChange[]
  overlappingFields: string[]
}

export type ConflictResolutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conflict: ConflictData
  entityLabel: string
  onResolved: (resolution: 'accept_incoming' | 'accept_mine' | 'merged', savedData: Record<string, unknown>) => void
}

export function ConflictResolutionDialog({
  open,
  onOpenChange,
  conflict,
  entityLabel,
  onResolved,
}: ConflictResolutionDialogProps) {
  const t = useT()
  const [activeTab, setActiveTab] = React.useState<'quick' | 'merge'>('quick')
  const [mergeDecisions, setMergeDecisions] = React.useState<Map<string, 'accept_incoming' | 'accept_mine' | 'custom'>>(
    new Map()
  )
  const [customValues, setCustomValues] = React.useState<Map<string, unknown>>(new Map())
  const [resolving, setResolving] = React.useState(false)
  
  // Initialize merge decisions with incoming values
  React.useEffect(() => {
    const initial = new Map<string, 'accept_incoming' | 'accept_mine' | 'custom'>()
    for (const field of conflict.overlappingFields) {
      initial.set(field, 'accept_incoming')
    }
    setMergeDecisions(initial)
  }, [conflict.overlappingFields])
  
  async function handleResolve(resolution: 'accept_incoming' | 'accept_mine' | 'merged') {
    setResolving(true)
    try {
      let mergedData: Record<string, unknown> | undefined
      let decisions: Array<{ path: string; decision: string; customValue?: unknown }> | undefined
      
      if (resolution === 'merged') {
        // Build merged data from decisions
        mergedData = JSON.parse(JSON.stringify(conflict.incomingSnapshot))
        decisions = []
        
        for (const [path, decision] of mergeDecisions.entries()) {
          if (decision === 'accept_mine') {
            setNestedValue(mergedData, path, getNestedValue(conflict.conflictingSnapshot, path))
          } else if (decision === 'custom') {
            setNestedValue(mergedData, path, customValues.get(path))
          }
          decisions.push({
            path,
            decision,
            customValue: decision === 'custom' ? customValues.get(path) : undefined,
          })
        }
      }
      
      const result = await apiCall<{ success: boolean; savedData: Record<string, unknown> }>(
        `/api/record-locks/conflicts/${conflict.id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({ resolution, mergedData, mergeDecisions: decisions }),
        }
      )
      
      if (result.ok && result.result?.success) {
        flash(t('recordLocks.conflictResolved'), 'success')
        onResolved(resolution, result.result.savedData)
        onOpenChange(false)
      } else {
        flash(t('recordLocks.resolveFailed'), 'error')
      }
    } catch (error) {
      flash(t('recordLocks.resolveFailed'), 'error')
    } finally {
      setResolving(false)
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('recordLocks.conflictDetected', { entity: entityLabel })}
          </DialogTitle>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'quick' | 'merge')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="quick">{t('recordLocks.quickActions')}</TabsTrigger>
            <TabsTrigger value="merge">
              {t('recordLocks.combineChanges')}
              {conflict.overlappingFields.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {conflict.overlappingFields.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="quick" className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Accept Incoming */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-lg font-medium">
                  <ArrowLeft className="h-5 w-5 text-blue-500" />
                  {t('recordLocks.acceptIncoming')}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('recordLocks.acceptIncomingDesc')}
                </p>
                <div className="text-sm">
                  <strong>{t('recordLocks.changesFromOther')}:</strong>
                  <ul className="mt-1 space-y-1">
                    {conflict.incomingChanges.slice(0, 5).map(change => (
                      <li key={change.path} className="text-muted-foreground">
                        • {change.path}: {formatValue(change.oldValue)} → {formatValue(change.newValue)}
                      </li>
                    ))}
                    {conflict.incomingChanges.length > 5 && (
                      <li className="text-muted-foreground">
                        ... {t('recordLocks.andMore', { count: conflict.incomingChanges.length - 5 })}
                      </li>
                    )}
                  </ul>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => handleResolve('accept_incoming')}
                  disabled={resolving}
                >
                  <Check className="mr-1 h-4 w-4" />
                  {t('recordLocks.useThisVersion')}
                </Button>
              </div>
              
              {/* Accept Mine */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-lg font-medium">
                  <ArrowRight className="h-5 w-5 text-green-500" />
                  {t('recordLocks.acceptMine')}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('recordLocks.acceptMineDesc')}
                </p>
                <div className="text-sm">
                  <strong>{t('recordLocks.myChanges')}:</strong>
                  <ul className="mt-1 space-y-1">
                    {conflict.conflictingChanges.slice(0, 5).map(change => (
                      <li key={change.path} className="text-muted-foreground">
                        • {change.path}: {formatValue(change.oldValue)} → {formatValue(change.newValue)}
                      </li>
                    ))}
                    {conflict.conflictingChanges.length > 5 && (
                      <li className="text-muted-foreground">
                        ... {t('recordLocks.andMore', { count: conflict.conflictingChanges.length - 5 })}
                      </li>
                    )}
                  </ul>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => handleResolve('accept_mine')}
                  disabled={resolving}
                >
                  <Check className="mr-1 h-4 w-4" />
                  {t('recordLocks.useThisVersion')}
                </Button>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="merge" className="py-4">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('recordLocks.mergeInstructions')}
              </p>
              
              <ScrollArea className="h-[400px] border rounded-lg">
                <div className="divide-y">
                  {conflict.overlappingFields.map(fieldPath => {
                    const incomingChange = conflict.incomingChanges.find(c => c.path === fieldPath)
                    const myChange = conflict.conflictingChanges.find(c => c.path === fieldPath)
                    const decision = mergeDecisions.get(fieldPath) || 'accept_incoming'
                    
                    return (
                      <div key={fieldPath} className="p-4 space-y-3">
                        <div className="font-medium text-sm flex items-center gap-2">
                          <Badge variant="outline">{fieldPath}</Badge>
                          {decision === 'accept_incoming' && (
                            <Badge className="bg-blue-100 text-blue-800">Incoming</Badge>
                          )}
                          {decision === 'accept_mine' && (
                            <Badge className="bg-green-100 text-green-800">Mine</Badge>
                          )}
                          {decision === 'custom' && (
                            <Badge className="bg-purple-100 text-purple-800">Custom</Badge>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {/* Incoming value */}
                          <button
                            type="button"
                            className={`p-3 rounded border text-left transition-colors ${
                              decision === 'accept_incoming'
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-blue-300'
                            }`}
                            onClick={() => setMergeDecisions(prev => new Map(prev).set(fieldPath, 'accept_incoming'))}
                          >
                            <div className="font-medium text-blue-700 mb-1">
                              {t('recordLocks.incomingValue')}
                            </div>
                            <div className="text-gray-600 font-mono text-xs break-all">
                              {formatValue(incomingChange?.newValue)}
                            </div>
                          </button>
                          
                          {/* My value */}
                          <button
                            type="button"
                            className={`p-3 rounded border text-left transition-colors ${
                              decision === 'accept_mine'
                                ? 'border-green-500 bg-green-50'
                                : 'border-gray-200 hover:border-green-300'
                            }`}
                            onClick={() => setMergeDecisions(prev => new Map(prev).set(fieldPath, 'accept_mine'))}
                          >
                            <div className="font-medium text-green-700 mb-1">
                              {t('recordLocks.myValue')}
                            </div>
                            <div className="text-gray-600 font-mono text-xs break-all">
                              {formatValue(myChange?.newValue)}
                            </div>
                          </button>
                        </div>
                        
                        <div className="text-xs text-muted-foreground">
                          {t('recordLocks.originalValue')}: {formatValue(incomingChange?.oldValue)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
              
              <Button
                className="w-full"
                onClick={() => handleResolve('merged')}
                disabled={resolving}
              >
                <GitMerge className="mr-1 h-4 w-4" />
                {t('recordLocks.applyMerge')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={resolving}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: any, key) => acc?.[key], obj)
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  const last = parts.pop()!
  const target = parts.reduce((acc: any, key) => {
    if (!acc[key]) acc[key] = {}
    return acc[key]
  }, obj)
  target[last] = value
}
```

### Hook: useRecordLock

```typescript
// packages/core/src/modules/record_locks/hooks/useRecordLock.ts
'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { ConflictData } from '../components/ConflictResolutionDialog'

export type UseRecordLockOptions = {
  entityType: string
  recordId: string
  initialSnapshot: Record<string, unknown>
  enabled?: boolean
  onConflict?: (conflict: ConflictData) => void
}

export type UseRecordLockResult = {
  isLocked: boolean
  isMyLock: boolean
  lockError: string | null
  lockedBy: { userId: string; userName: string; expiresAt: Date } | null
  expiresAt: Date | null
  conflict: ConflictData | null
  acquireLock: () => Promise<boolean>
  releaseLock: (reason: 'saved' | 'cancelled') => Promise<void>
  validateSave: (newData: Record<string, unknown>) => Promise<{ valid: boolean; conflict?: ConflictData }>
  clearConflict: () => void
}

export function useRecordLock({
  entityType,
  recordId,
  initialSnapshot,
  enabled = true,
  onConflict,
}: UseRecordLockOptions): UseRecordLockResult {
  const [state, setState] = React.useState<{
    isLocked: boolean
    isMyLock: boolean
    lockError: string | null
    lockedBy: { userId: string; userName: string; expiresAt: Date } | null
    expiresAt: Date | null
    conflict: ConflictData | null
  }>({
    isLocked: false,
    isMyLock: false,
    lockError: null,
    lockedBy: null,
    expiresAt: null,
    conflict: null,
  })
  
  const heartbeatRef = React.useRef<NodeJS.Timeout | null>(null)
  
  const acquireLock = React.useCallback(async (): Promise<boolean> => {
    if (!enabled) return true
    
    try {
      const result = await apiCall<{
        acquired: boolean
        lock?: { id: string; expiresAt: string }
        lockedBy?: { userId: string; userName: string; lockedAt: string; expiresAt: string }
        reason?: string
      }>('/api/record-locks/acquire', {
        method: 'POST',
        body: JSON.stringify({ entityType, recordId, initialSnapshot }),
      })
      
      if (result.ok && result.result?.acquired) {
        setState(prev => ({
          ...prev,
          isLocked: true,
          isMyLock: true,
          expiresAt: new Date(result.result!.lock!.expiresAt),
          lockError: null,
        }))
        
        // Start heartbeat
        heartbeatRef.current = setInterval(async () => {
          await apiCall('/api/record-locks/heartbeat', {
            method: 'POST',
            body: JSON.stringify({ entityType, recordId }),
          })
        }, 30000)
        
        return true
      }
      
      if (result.result?.lockedBy) {
        setState(prev => ({
          ...prev,
          isLocked: true,
          isMyLock: false,
          lockedBy: {
            userId: result.result!.lockedBy!.userId,
            userName: result.result!.lockedBy!.userName,
            expiresAt: new Date(result.result!.lockedBy!.expiresAt),
          },
        }))
      }
      
      return false
    } catch (error) {
      setState(prev => ({
        ...prev,
        lockError: 'Failed to acquire lock',
      }))
      return false
    }
  }, [enabled, entityType, recordId, initialSnapshot])
  
  const releaseLock = React.useCallback(async (reason: 'saved' | 'cancelled'): Promise<void> => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    
    try {
      await apiCall('/api/record-locks/release', {
        method: 'POST',
        body: JSON.stringify({ entityType, recordId, reason }),
      })
    } catch (error) {
      console.error('Failed to release lock:', error)
    }
    
    setState(prev => ({
      ...prev,
      isLocked: false,
      isMyLock: false,
      expiresAt: null,
    }))
  }, [entityType, recordId])
  
  const validateSave = React.useCallback(async (newData: Record<string, unknown>): Promise<{
    valid: boolean
    conflict?: ConflictData
  }> => {
    try {
      const result = await apiCall<{
        valid: boolean
        conflict?: ConflictData
      }>('/api/record-locks/validate-save', {
        method: 'POST',
        body: JSON.stringify({
          entityType,
          recordId,
          currentSnapshot: initialSnapshot,
          newData,
        }),
      })
      
      if (result.ok && result.result?.valid) {
        return { valid: true }
      }
      
      if (result.result?.conflict) {
        setState(prev => ({ ...prev, conflict: result.result!.conflict! }))
        onConflict?.(result.result.conflict)
        return { valid: false, conflict: result.result.conflict }
      }
      
      return { valid: false }
    } catch (error) {
      return { valid: false }
    }
  }, [entityType, recordId, initialSnapshot, onConflict])
  
  const clearConflict = React.useCallback(() => {
    setState(prev => ({ ...prev, conflict: null }))
  }, [])
  
  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
      }
    }
  }, [])
  
  return {
    ...state,
    acquireLock,
    releaseLock,
    validateSave,
    clearConflict,
  }
}
```

---

## Events

```typescript
// packages/core/src/modules/record_locks/lib/events.ts
export const RECORD_LOCK_EVENTS = {
  ACQUIRED: 'record_locks.acquired',
  RELEASED: 'record_locks.released',
  FORCE_RELEASED: 'record_locks.force_released',
  EXPIRED: 'record_locks.expired',
  CONFLICT_DETECTED: 'record_locks.conflict_detected',
  CONFLICT_RESOLVED: 'record_locks.conflict_resolved',
} as const

export type LockAcquiredPayload = {
  lockId: string
  entityType: string
  recordId: string
  userId: string
  tenantId: string
}

export type LockReleasedPayload = {
  lockId: string
  entityType: string
  recordId: string
  userId: string
  reason: 'saved' | 'cancelled' | 'conflict_resolved'
  tenantId: string
}

export type LockForceReleasedPayload = {
  lockId: string
  entityType: string
  recordId: string
  originalUserId: string
  adminUserId: string
  tenantId: string
}

export type ConflictDetectedPayload = {
  conflictId: string
  entityType: string
  recordId: string
  originalUserId: string
  conflictingUserId: string
  overlappingFields: string[]
  tenantId: string
}

export type ConflictResolvedPayload = {
  conflictId: string
  entityType: string
  recordId: string
  resolution: 'accept_incoming' | 'accept_mine' | 'merged'
  originalUserId: string
  conflictingUserId: string
  resolvedByUserId: string
  tenantId: string
}
```

---

## Notifications Integration

### Subscriber: Notify on Force Release

```typescript
// packages/core/src/modules/record_locks/subscribers/notify-force-release.ts
import { createQueue } from '@open-mercato/queue'
import type { LockForceReleasedPayload } from '../lib/events'

export const metadata = {
  event: 'record_locks.force_released',
  id: 'record_locks:notify-force-release',
  persistent: true,
}

export default async function handle(
  payload: LockForceReleasedPayload,
  ctx: { resolve: <T>(name: string) => T }
): Promise<void> {
  const notifQueue = createQueue('notifications', 'async')
  
  await notifQueue.enqueue({
    type: 'create',
    input: {
      recipientUserId: payload.originalUserId,
      type: 'record_locks.force_released',
      title: 'Your edit lock was released',
      body: 'An administrator released your lock on a record you were editing',
      icon: 'unlock',
      severity: 'warning',
      sourceModule: 'record_locks',
      sourceEntityType: payload.entityType,
      sourceEntityId: payload.recordId,
    },
    tenantId: payload.tenantId,
  })
}
```

### Subscriber: Notify on Conflict

```typescript
// packages/core/src/modules/record_locks/subscribers/notify-conflict.ts
import { createQueue } from '@open-mercato/queue'
import type { ConflictDetectedPayload } from '../lib/events'

export const metadata = {
  event: 'record_locks.conflict_detected',
  id: 'record_locks:notify-conflict',
  persistent: true,
}

export default async function handle(
  payload: ConflictDetectedPayload,
  ctx: { resolve: <T>(name: string) => T }
): Promise<void> {
  const notifQueue = createQueue('notifications', 'async')
  
  // Notify the conflicting user (who tried to save)
  await notifQueue.enqueue({
    type: 'create',
    input: {
      recipientUserId: payload.conflictingUserId,
      type: 'record_locks.conflict_detected',
      title: 'Edit conflict detected',
      body: 'Your changes conflict with changes made by another user. Please resolve the conflict.',
      icon: 'git-branch',
      severity: 'warning',
      sourceModule: 'record_locks',
      sourceEntityType: 'record_conflict',
      sourceEntityId: payload.conflictId,
      linkHref: `/backend/conflicts/${payload.conflictId}`,
      actionData: {
        actions: [
          { id: 'resolve', label: 'Resolve Conflict', variant: 'default', href: `/backend/conflicts/${payload.conflictId}` },
        ],
      },
    },
    tenantId: payload.tenantId,
  })
  
  // Also notify the original user
  await notifQueue.enqueue({
    type: 'create',
    input: {
      recipientUserId: payload.originalUserId,
      type: 'record_locks.conflict_with_your_edit',
      title: 'Someone edited the same record',
      body: 'Another user tried to save changes to a record you recently edited. They will resolve the conflict.',
      icon: 'git-branch',
      severity: 'info',
      sourceModule: 'record_locks',
      sourceEntityType: payload.entityType,
      sourceEntityId: payload.recordId,
    },
    tenantId: payload.tenantId,
  })
}
```

### Subscriber: Notify on Resolution

```typescript
// packages/core/src/modules/record_locks/subscribers/notify-resolution.ts
import { createQueue } from '@open-mercato/queue'
import type { ConflictResolvedPayload } from '../lib/events'

export const metadata = {
  event: 'record_locks.conflict_resolved',
  id: 'record_locks:notify-resolution',
  persistent: true,
}

export default async function handle(
  payload: ConflictResolvedPayload,
  ctx: { resolve: <T>(name: string) => T }
): Promise<void> {
  const notifQueue = createQueue('notifications', 'async')
  
  const resolutionLabels = {
    accept_incoming: 'accepted the other version',
    accept_mine: 'kept their version',
    merged: 'merged both versions',
  }
  
  // Notify both users
  const userIds = [payload.originalUserId, payload.conflictingUserId]
  
  for (const userId of userIds) {
    const isResolver = userId === payload.resolvedByUserId
    
    await notifQueue.enqueue({
      type: 'create',
      input: {
        recipientUserId: userId,
        type: 'record_locks.conflict_resolved',
        title: isResolver ? 'Conflict resolved' : 'Edit conflict was resolved',
        body: isResolver
          ? `You ${resolutionLabels[payload.resolution]}`
          : `The other user ${resolutionLabels[payload.resolution]}`,
        icon: 'check-circle',
        severity: 'success',
        sourceModule: 'record_locks',
        sourceEntityType: payload.entityType,
        sourceEntityId: payload.recordId,
      },
      tenantId: payload.tenantId,
    })
  }
}
```

---

## Workers

### Worker: Cleanup Expired Locks

```typescript
// packages/core/src/modules/record_locks/workers/cleanup.worker.ts
import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/core'

export const CLEANUP_QUEUE_NAME = 'record-locks-cleanup'

export const metadata: WorkerMeta = {
  queue: CLEANUP_QUEUE_NAME,
  id: 'record_locks:cleanup',
  concurrency: 1,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

export default async function handle(
  job: QueuedJob<{ runAt: string }>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const lockService = ctx.resolve('recordLockService') as any
  const count = await lockService.cleanupExpiredLocks()
  
  if (count > 0) {
    console.log(`[record_locks:cleanup] Expired ${count} locks`)
  }
}
```

---

## ACL (Features)

```typescript
// packages/core/src/modules/record_locks/acl.ts
export const features = [
  'record_locks.view',    // View lock status
  'record_locks.manage',  // Force release locks, configure settings
]
```

---

## i18n Keys

```json
// packages/core/src/modules/record_locks/i18n/en.json
{
  "recordLocks": {
    "config": {
      "title": "Record Locking",
      "strategy": "Locking Strategy",
      "strategyOptimistic": "Optimistic (allow concurrent edits, detect conflicts)",
      "strategyPessimistic": "Pessimistic (block editing when locked)",
      "timeout": "Lock Timeout (seconds)",
      "heartbeat": "Heartbeat Interval (seconds)",
      "allowLockRequests": "Allow users to request lock release",
      "autoMergeTrivial": "Auto-merge non-overlapping changes"
    },
    "acquiringLock": "Acquiring edit lock...",
    "youHaveLock": "You are editing this record",
    "lockExpiresIn": "Lock expires in {time}",
    "recordLocked": "Record is locked",
    "lockedByUser": "This record is being edited by {userName} (started {time})",
    "beingEdited": "Currently being edited",
    "beingEditedByUser": "{userName} is also editing this record",
    "conflictMayOccur": "If you save, a conflict may occur if they save first.",
    "forceRelease": "Force Release Lock",
    "confirmForceRelease": "Are you sure you want to force release this lock? The other user may lose unsaved changes.",
    "lockForceReleased": "Lock has been released",
    "forceReleaseFailed": "Failed to release lock",
    "conflictDetected": "Conflict detected on {entity}",
    "quickActions": "Quick Actions",
    "combineChanges": "Combine Changes",
    "acceptIncoming": "Accept Incoming",
    "acceptIncomingDesc": "Discard your changes and use the version saved by the other user",
    "acceptMine": "Accept Mine",
    "acceptMineDesc": "Overwrite with your changes (the other user's changes will be lost)",
    "changesFromOther": "Their changes",
    "myChanges": "My changes",
    "andMore": "and {count} more",
    "useThisVersion": "Use This Version",
    "mergeInstructions": "Choose which version to keep for each conflicting field:",
    "incomingValue": "Their Value",
    "myValue": "My Value",
    "originalValue": "Original",
    "applyMerge": "Apply Merged Changes",
    "conflictResolved": "Conflict resolved successfully",
    "resolveFailed": "Failed to resolve conflict"
  }
}
```

---

## DI Registration

```typescript
// packages/core/src/modules/record_locks/di.ts
import type { AwilixContainer } from 'awilix'
import { asFunction } from 'awilix'
import { createRecordLockService } from './lib/lockService'

export function register(container: AwilixContainer): void {
  container.register({
    recordLockService: asFunction(({ em, eventBus }) =>
      createRecordLockService(em, eventBus)
    ).scoped(),
  })
}
```

---

## Integration with CrudForm

### CrudForm Enhancement

```typescript
// Example integration in CrudForm
import { useRecordLock } from '@open-mercato/core/modules/record_locks/hooks/useRecordLock'
import { LockStatusBanner } from '@open-mercato/core/modules/record_locks/components/LockStatusBanner'
import { ConflictResolutionDialog } from '@open-mercato/core/modules/record_locks/components/ConflictResolutionDialog'

// Inside CrudForm component:
const {
  isLocked,
  isMyLock,
  lockedBy,
  conflict,
  acquireLock,
  releaseLock,
  validateSave,
  clearConflict,
} = useRecordLock({
  entityType: `${module}:${entity}`,
  recordId: record?.id,
  initialSnapshot: record,
  enabled: mode === 'edit' && lockingEnabled,
  onConflict: setShowConflictDialog,
})

// Before save:
async function handleSubmit(data) {
  // Validate for conflicts
  const { valid, conflict } = await validateSave(data)
  
  if (!valid && conflict) {
    setShowConflictDialog(true)
    return
  }
  
  // Proceed with save...
  await saveCrud(data)
  await releaseLock('saved')
}

// In render:
<>
  <LockStatusBanner
    entityType={entityType}
    recordId={record.id}
    initialSnapshot={record}
    strategy={lockConfig.strategy}
    canForceRelease={hasFeature('record_locks.manage')}
  />
  
  {conflict && (
    <ConflictResolutionDialog
      open={showConflictDialog}
      onOpenChange={setShowConflictDialog}
      conflict={conflict}
      entityLabel={entityLabel}
      onResolved={(resolution, savedData) => {
        clearConflict()
        // Refresh form with saved data
        reset(savedData)
      }}
    />
  )}
  
  {/* Form disabled in pessimistic mode when locked by another */}
  <fieldset disabled={lockConfig.strategy === 'pessimistic' && isLocked && !isMyLock}>
    {/* Form fields */}
  </fieldset>
</>
```

---

## Test Scenarios

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Acquire lock | User opens edit form | Form loads | Lock acquired, banner shows "editing" |
| Lock denied (pessimistic) | Another user has lock, pessimistic mode | User opens same record | Form disabled, shows who is editing |
| Lock denied (optimistic) | Another user has lock, optimistic mode | User opens same record | Warning shown but form enabled |
| Heartbeat extends | User is editing | 30 seconds pass | Heartbeat sent, lock extended |
| Lock expires | User stops interacting | Timeout passes | Lock status changes to expired |
| Force release | Admin clicks force release | POST /api/record-locks/force-release | Lock released, original user notified |
| No conflict | User A saves, User B saves different fields | User B submits | Both changes saved (auto-merge if enabled) |
| Conflict detected | User A and B change same field | User B submits after A | Conflict dialog shown to B |
| Accept incoming | User in conflict dialog | Clicks "Accept Incoming" | A's version kept, B notified |
| Accept mine | User in conflict dialog | Clicks "Accept Mine" | B's version kept, A notified |
| Merge changes | User in conflict dialog | Selects per-field, clicks Merge | Combined version saved, both notified |
| Cleanup job | Expired locks exist | Cleanup worker runs | Expired locks marked as expired |
| Config change | Admin changes strategy | Saves config | New strategy applies to new locks |
