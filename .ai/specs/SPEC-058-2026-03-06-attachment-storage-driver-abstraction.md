# SPEC-058 — Attachment Storage Driver Abstraction

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Claude (AI-assisted) |
| **Created** | 2026-03-06 |
| **Related** | Attachments module (`packages/core/src/modules/attachments/`) |

## TLDR

Introduce a pluggable `StorageDriver` interface for the attachments module so each partition can independently store files on **local disk** (current behavior), **S3-compatible object storage** (AWS S3, DigitalOcean Spaces, MinIO), or **PostgreSQL** (`bytea` blobs). Metadata remains in PostgreSQL. The existing `storageDriver` and `configJson` columns on `Attachment` and `AttachmentPartition` entities are already present but unused — this spec activates them with a proper abstraction layer, driver factory, and DI registration.

---

## 1. Problem Statement

The attachments module stores all file data on the local filesystem. This works for single-server deployments but creates issues for:

1. **Horizontally scaled deployments** — uploaded files are only available on the node that received the upload. No shared storage without external NFS/volume mounts.
2. **Cloud-native deployments** — ephemeral containers lose local storage on restart. Files must live in durable object storage (S3, Spaces).
3. **Small-scale / embedded deployments** — some operators prefer storing small attachments directly in PostgreSQL to eliminate filesystem dependencies entirely.
4. **Per-partition flexibility** — public product media may belong in S3 (CDN-friendly) while private internal documents stay on local disk or in the database.

The `storageDriver` field (default `'local'`) and `configJson` (nullable JSONB) already exist on both `Attachment` and `AttachmentPartition` entities, indicating the architecture was designed for extensibility. Only `'local'` and `'legacyPublic'` drivers are implemented, and all file I/O uses direct `fs` calls scattered across 7+ files with no abstraction.

---

## 2. Architecture Overview

```
                           ┌─────────────────────────┐
                           │   StorageDriverFactory   │
                           │   (DI: storageDriver-    │
                           │    Factory)               │
                           └────────┬────────────────┘
                                    │ resolveForAttachment(driver, config)
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
          ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐
          │   Local      │ │   S3        │ │   Database      │
          │   Driver     │ │   Driver    │ │   Driver        │
          │              │ │             │ │                  │
          │ fs.read/     │ │ GetObject/  │ │ SELECT/INSERT   │
          │ fs.write/    │ │ PutObject/  │ │ attachment_     │
          │ fs.unlink    │ │ DeleteObj   │ │ blobs           │
          └─────────────┘ └─────────────┘ └─────────────────┘

  All drivers implement:
  ┌─────────────────────────────────────────────────────────┐
  │  interface StorageDriver {                               │
  │    store(payload): Promise<StoredFile>                   │
  │    read(partition, path): Promise<ReadFileResult>        │
  │    delete(partition, path): Promise<void>                │
  │    toLocalPath(partition, path): Promise<LocalPathRef>   │
  │  }                                                       │
  └─────────────────────────────────────────────────────────┘

  Call sites (API routes, OCR, CLI) resolve driver via factory:
  ┌──────────────────────────────────────────────────────────┐
  │  const factory = resolve('storageDriverFactory')          │
  │  const driver = factory.resolveForAttachment(             │
  │    attachment.storageDriver,                              │
  │    partition.configJson                                   │
  │  )                                                        │
  │  const { buffer } = await driver.read(code, path)         │
  └──────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **`toLocalPath()` with cleanup callback**: OCR (OpenAI Vision, pdf2pic) and text extraction (markitdown CLI) require a real filesystem path. For remote drivers, `toLocalPath()` downloads to a temp directory and returns a `cleanup()` function. Local driver returns the real path with a no-op cleanup.
- **No `absolutePath` in `StoredFile`**: Only meaningful for local driver. Callers use `read()` for buffers or `toLocalPath()` when a disk path is needed.
- **Thumbnail cache stays local**: Thumbnails are ephemeral cache. `thumbnailCache.ts` is updated to use a dedicated `storage/.cache/thumbnails/` directory independent of partition root.
- **Credentials via environment variables only**: S3 credentials are never stored in the database. The `configJson` field holds a `credentialsEnvPrefix` string that maps to `{PREFIX}_ACCESS_KEY_ID` / `{PREFIX}_SECRET_ACCESS_KEY` env vars. Falls back to default AWS credential chain (IAM roles).

---

## 3. Proposed Solution

### 3.1 StorageDriver Interface

**New file**: `packages/core/src/modules/attachments/lib/drivers/types.ts`

```typescript
export type StoreFilePayload = {
  partitionCode: string
  orgId: string | null | undefined
  tenantId: string | null | undefined
  fileName: string
  buffer: Buffer
}

export type StoredFile = {
  storagePath: string
  driverMeta?: Record<string, unknown> | null
}

export type ReadFileResult = {
  buffer: Buffer
  contentType?: string
}

export interface StorageDriver {
  readonly key: string
  store(payload: StoreFilePayload): Promise<StoredFile>
  read(partitionCode: string, storagePath: string): Promise<ReadFileResult>
  delete(partitionCode: string, storagePath: string): Promise<void>
  toLocalPath(partitionCode: string, storagePath: string): Promise<{
    filePath: string
    cleanup: () => Promise<void>
  }>
}
```

### 3.2 Driver Implementations

#### LocalStorageDriver

**New file**: `lib/drivers/localDriver.ts`

Extracts existing logic from `lib/storage.ts` (sanitizeFileName, org/tenant segments, unique naming). Reuses `resolvePartitionRoot()`.

| Method | Behavior |
|--------|----------|
| `store()` | `mkdir` + `writeFile` (same as current `storePartitionFile`) |
| `read()` | `fs.readFile` with resolved absolute path |
| `delete()` | `fs.unlink` best-effort |
| `toLocalPath()` | Returns absolute path with no-op cleanup |

#### LegacyPublicStorageDriver

**New file**: `lib/drivers/legacyPublicDriver.ts`

Read-only driver for backward compat. Resolves paths via `path.join(process.cwd(), safeRelative)`. `store()` throws — legacy is read-only.

#### S3StorageDriver

**New file**: `lib/drivers/s3Driver.ts`

Uses `@aws-sdk/client-s3`. Compatible with AWS S3, DigitalOcean Spaces, MinIO, and any S3-compatible provider.

```typescript
export type S3DriverConfig = {
  bucket: string
  region?: string
  endpoint?: string              // for DO Spaces, MinIO
  pathPrefix?: string            // e.g. "attachments/"
  forcePathStyle?: boolean       // for MinIO
  credentialsEnvPrefix?: string  // e.g. "MY_S3" -> reads MY_S3_ACCESS_KEY_ID, MY_S3_SECRET_ACCESS_KEY
}
```

| Method | Behavior |
|--------|----------|
| `store()` | `PutObjectCommand`, key = `{pathPrefix}{partitionCode}/{org_seg}/{tenant_seg}/{timestamp}_{uuid}_{name}` |
| `read()` | `GetObjectCommand`, stream body to Buffer |
| `delete()` | `DeleteObjectCommand` best-effort |
| `toLocalPath()` | Download to `os.tmpdir()`, return cleanup that removes temp dir |

Credential resolution:
1. If `credentialsEnvPrefix` is set, read `{PREFIX}_ACCESS_KEY_ID` and `{PREFIX}_SECRET_ACCESS_KEY` from env.
2. Otherwise, fall back to the default AWS SDK credential chain (IAM roles, instance profiles, `~/.aws/credentials`).

#### DatabaseStorageDriver

**New file**: `lib/drivers/databaseDriver.ts`

Stores file contents as `bytea` in a new `attachment_blobs` table.

| Method | Behavior |
|--------|----------|
| `store()` | Create `AttachmentBlob` entity, `storagePath` = blob UUID |
| `read()` | `findOneOrFail` by id, return `.data` buffer |
| `delete()` | Find + remove best-effort |
| `toLocalPath()` | Write buffer to temp file, return cleanup |

### 3.3 Driver Factory

**New file**: `lib/drivers/driverFactory.ts`

```typescript
export class StorageDriverFactory {
  constructor(private readonly em: EntityManager) {}

  resolveForAttachment(
    storageDriver: string,
    configJson?: Record<string, unknown> | null
  ): StorageDriver

  async resolveForPartition(partitionCode: string): Promise<StorageDriver>
}
```

- Caches driver instances per config hash (avoids recreating S3 clients per request).
- Falls back to local for unknown `storageDriver` values.
- `resolveForAttachment()` used when reading/deleting (attachment + partition already loaded).
- `resolveForPartition()` used when uploading (loads partition from DB).

### 3.4 DI Registration

**New file**: `packages/core/src/modules/attachments/di.ts`

```typescript
import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { StorageDriverFactory } from './lib/drivers/driverFactory'

export function register(container: AppContainer) {
  container.register({
    storageDriverFactory: asFunction(({ em }) => new StorageDriverFactory(em))
      .singleton()
      .proxy(),
  })
}
```

Uses `.singleton().proxy()` pattern (matches `sales/di.ts`). The proxy defers `em` resolution to call-time, so the request-scoped em is used correctly.

Run `yarn modules:prepare` after creating.

---

## 4. Data Models

### 4.1 Existing Entities (no schema changes)

**`attachment_partitions`** — already has:
- `storage_driver text DEFAULT 'local'`
- `config_json jsonb NULL`

**`attachments`** — already has:
- `storage_driver text DEFAULT 'local'`

### 4.2 New Entity: AttachmentBlob

**Table**: `attachment_blobs`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, `gen_random_uuid()` | Blob identifier (= `storagePath` on the attachment row) |
| `partition_code` | `text` | NOT NULL | Partition code reference |
| `org_id` | `uuid` | NULL | Organization scope |
| `tenant_id` | `uuid` | NULL | Tenant scope |
| `file_name` | `text` | NOT NULL | Original filename |
| `data` | `bytea` | NOT NULL | File binary content |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |

Added to `packages/core/src/modules/attachments/data/entities.ts`.

### 4.3 Migration

New migration file in `packages/core/src/modules/attachments/migrations/` creates the `attachment_blobs` table. Generated via `yarn db:generate` after adding the entity.

---

## 5. API Contracts

### 5.1 Modified: Partition CRUD (`/api/attachments/partitions`)

**POST** and **PUT** schemas extended with:

```typescript
storageDriver: z.enum(['local', 's3', 'database']).optional().default('local')
configJson: z.record(z.unknown()).optional().nullable()
```

**GET** response includes `storageDriver` and `configJson` per partition.

The `serializePartition()` function is updated to include both fields. The `partitionSchema` in `api/openapi.ts` is extended accordingly.

### 5.2 No Changes to Other API Contracts

Upload (`POST /api/attachments`), download (`GET /api/attachments/file/{id}`), image (`GET /api/attachments/image/{id}`), library, transfer, and delete APIs retain their existing request/response shapes. The storage driver is resolved internally from the partition configuration.

---

## 6. File Inventory

### New Files

| File | Purpose |
|------|---------|
| `lib/drivers/types.ts` | `StorageDriver` interface, payload/result types |
| `lib/drivers/localDriver.ts` | Local filesystem driver |
| `lib/drivers/legacyPublicDriver.ts` | Legacy read-only driver |
| `lib/drivers/s3Driver.ts` | S3-compatible driver |
| `lib/drivers/databaseDriver.ts` | PostgreSQL blob driver |
| `lib/drivers/driverFactory.ts` | Factory/registry with caching |
| `lib/drivers/index.ts` | Barrel export |
| `di.ts` | DI registration for `storageDriverFactory` |

### Modified Files

| File | Change |
|------|--------|
| `data/entities.ts` | Add `AttachmentBlob` entity |
| `api/route.ts` | POST: use `driver.store()` + `toLocalPath()` for OCR/extraction. DELETE: use `driver.delete()` |
| `api/file/[id]/route.ts` | Replace `resolveAttachmentAbsolutePath()` + `fs.readFile()` with `driver.read()` |
| `api/image/[id]/[[...slug]]/route.ts` | Replace `fs.readFile()` with `driver.read()`, pass Buffer to `sharp()` |
| `api/library/[id]/route.ts` | DELETE: replace `deletePartitionFile()` with `driver.delete()` |
| `api/partitions/route.ts` | Accept `storageDriver` + `configJson` in POST/PUT schemas |
| `api/openapi.ts` | Extend `partitionSchema` / `partitionCreateSchema` / `partitionUpdateSchema` with `storageDriver` and `configJson` |
| `lib/storage.ts` | Mark `storePartitionFile`, `resolveAttachmentAbsolutePath`, `deletePartitionFile` as `@deprecated`. Keep `resolvePartitionRoot()`. |
| `lib/ocrQueue.ts` | Pass storage ref instead of `filePath`. Use `toLocalPath()` with cleanup in `processAttachmentOcr`. |
| `lib/thumbnailCache.ts` | Use dedicated `storage/.cache/thumbnails/{partitionCode}/` directory instead of `resolvePartitionRoot()` |
| `cli.ts` | Load partition per attachment, replace `deletePartitionFile()` with `driver.delete()` |

### New Dependency

```
"@aws-sdk/client-s3": "^3.x"
```

Added to the core package or root `package.json`.

---

## 7. configJson Examples

### Local (default)

```json
{ "storageDriver": "local", "configJson": null }
```

Uses `ATTACHMENTS_PARTITION_{CODE}_ROOT` env var or defaults to `<cwd>/storage/attachments/<code>`.

### AWS S3

```json
{
  "storageDriver": "s3",
  "configJson": {
    "bucket": "my-company-attachments",
    "region": "eu-west-1",
    "pathPrefix": "attachments/",
    "credentialsEnvPrefix": "MY_S3"
  }
}
```

Reads `MY_S3_ACCESS_KEY_ID` and `MY_S3_SECRET_ACCESS_KEY` from environment.

### DigitalOcean Spaces

```json
{
  "storageDriver": "s3",
  "configJson": {
    "bucket": "my-space",
    "region": "fra1",
    "endpoint": "https://fra1.digitaloceanspaces.com",
    "credentialsEnvPrefix": "DO_SPACES"
  }
}
```

### MinIO (self-hosted)

```json
{
  "storageDriver": "s3",
  "configJson": {
    "bucket": "attachments",
    "region": "us-east-1",
    "endpoint": "http://minio:9000",
    "forcePathStyle": true,
    "credentialsEnvPrefix": "MINIO"
  }
}
```

### Database (PostgreSQL blobs)

```json
{ "storageDriver": "database", "configJson": null }
```

No extra config — uses the existing MikroORM PostgreSQL connection.

---

## 8. Implementation Phases

### Phase 1 — Foundation (no behavior changes)

1. Create `lib/drivers/types.ts` (interface + types)
2. Create `lib/drivers/localDriver.ts` (extract from `storage.ts`)
3. Create `lib/drivers/legacyPublicDriver.ts`
4. Create `lib/drivers/driverFactory.ts` (local + legacyPublic only)
5. Create `lib/drivers/index.ts` (barrel export)
6. Create `di.ts`, run `yarn modules:prepare`

### Phase 2 — Wire factory into existing call sites

7. Update `api/file/[id]/route.ts` to use `driver.read()`
8. Update `api/image/[id]/[[...slug]]/route.ts` to use `driver.read()`
9. Update `api/route.ts` POST to use `driver.store()` + `toLocalPath()` for OCR/text extraction
10. Update `api/route.ts` DELETE to use `driver.delete()`
11. Update `api/library/[id]/route.ts` DELETE to use `driver.delete()`
12. Update `cli.ts` to use `driver.delete()`
13. Update `lib/ocrQueue.ts` to use `toLocalPath()` with cleanup
14. Update `lib/thumbnailCache.ts` to use dedicated cache directory
15. Deprecate old functions in `lib/storage.ts`

### Phase 3 — Add remote drivers

16. Add `@aws-sdk/client-s3` dependency
17. Create `lib/drivers/s3Driver.ts`
18. Add `AttachmentBlob` entity to `data/entities.ts`
19. Generate migration for `attachment_blobs` table (`yarn db:generate`)
20. Create `lib/drivers/databaseDriver.ts`
21. Register new drivers in `driverFactory.ts`
22. Update `api/partitions/route.ts` schema + handlers
23. Update `api/openapi.ts` with storage-related fields

---

## 9. Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Breaking existing local file paths during refactor | High | All attachment operations | Phase 1 & 2 are behavior-preserving. Local driver reuses exact same path logic from `storage.ts`. | Low — integration tests cover upload/download/delete flow |
| S3 credentials misconfiguration | Medium | S3 driver uploads/downloads | Validate `credentialsEnvPrefix` resolves to non-empty env vars at driver construction time. Log clear error messages. | Medium — operator error is always possible |
| Large files in PostgreSQL `bytea` degrade performance | Medium | Database driver | Document recommended max file size (~50 MB). Consider adding `maxFileSizeMb` to database driver config. | Low — operator's choice, documented limitation |
| `toLocalPath()` temp files not cleaned up on crash | Low | S3/database drivers, OCR processing | Use `try/finally` pattern. Temp files in `os.tmpdir()` are cleaned by OS eventually. | Low |
| Thumbnail cache broken for S3/database partitions | Medium | Image resizing | Update `thumbnailCache.ts` to use dedicated cache dir independent of `resolvePartitionRoot()` | None — addressed in Phase 2 |
| `configJson` needed at read/delete time but only on partition | Low | File download/delete routes | All existing routes already load the partition alongside the attachment. No additional query needed. | None |
| EntityManager lifecycle for DatabaseStorageDriver in OCR queue | Medium | Background OCR processing | OCR queue already calls `em.fork()`. The forked em must be passed to the factory. | Low |

### Backward Compatibility

| Surface | Impact | Notes |
|---------|--------|-------|
| `Attachment` entity | None | `storageDriver` field already exists |
| `AttachmentPartition` entity | None | `storageDriver` + `configJson` fields already exist |
| API route URLs | None | No URL changes |
| API response shapes | Additive only | Partition responses gain `storageDriver` and `configJson` fields |
| `storePartitionFile` / `deletePartitionFile` / `resolveAttachmentAbsolutePath` | Deprecated | Kept with `@deprecated` JSDoc, still functional for any external callers |
| `resolvePartitionRoot` | Unchanged | Still used by thumbnail cache |
| Event IDs | None | No event changes |
| ACL features | None | No permission changes |
| Database schema | Additive only | New `attachment_blobs` table; no column changes on existing tables |

---

## 10. Integration Test Coverage

| Test Case | API Path | Description |
|-----------|----------|-------------|
| Upload with local driver | `POST /api/attachments` | Upload file, verify `storageDriver: 'local'`, download and verify content |
| Download with local driver | `GET /api/attachments/file/{id}` | Verify file content matches upload |
| Image resize with local driver | `GET /api/attachments/image/{id}` | Upload image, request thumbnail, verify 200 |
| Delete with local driver | `DELETE /api/attachments` | Upload, delete, verify file removed |
| Create partition with S3 config | `POST /api/attachments/partitions` | Create partition with `storageDriver: 's3'` and `configJson` |
| Create partition with database config | `POST /api/attachments/partitions` | Create partition with `storageDriver: 'database'` |
| Update partition storage driver | `PUT /api/attachments/partitions` | Change `storageDriver` on existing partition |
| Upload with database driver | `POST /api/attachments` | Upload to database-backed partition, verify `attachment_blobs` row |
| Download from database driver | `GET /api/attachments/file/{id}` | Download file stored in database |
| Delete from database driver | `DELETE /api/attachments` | Delete database-stored attachment, verify blob removed |
| Legacy compat | `GET /api/attachments/file/{id}` | Existing `legacyPublic` driver attachments still accessible |
| Library delete | `DELETE /api/attachments/library/{id}` | Delete via library endpoint using driver |
| CLI delete | CLI `attachments delete --id X` | Delete via CLI using driver |

S3 integration tests require a live S3-compatible endpoint (can use MinIO in CI via Docker).

---

## 11. Final Compliance Report

| Check | Status |
|-------|--------|
| TLDR present | Yes |
| Problem Statement | Yes |
| Architecture diagram | Yes |
| Data model changes documented | Yes — `AttachmentBlob` entity + migration |
| API contract changes documented | Yes — partition CRUD extended |
| Backward compatibility analysis | Yes — all additive, deprecated functions preserved |
| Risks with mitigations | Yes — 7 risks documented |
| Implementation phased | Yes — 3 phases, 23 steps |
| Integration test coverage | Yes — 13 test cases |
| No frozen surface violations | Yes — no event ID, widget spot ID, or auto-discovery changes |
| New dependency declared | Yes — `@aws-sdk/client-s3` |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-03-06 | Claude | Initial draft |
