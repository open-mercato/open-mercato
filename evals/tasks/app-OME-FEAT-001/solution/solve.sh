#!/usr/bin/env bash
# Oracle reference solution for app-OME-FEAT-001.
# Canonical, OM-conformant `bookmarks` CRUD module written entirely under
# /app/eval-app/src/modules/bookmarks, registered in src/modules.ts, with a
# real CLI-generated migration and refreshed codegen.
set -euo pipefail

APP_DIR="${OM_EVAL_APP_DIR:-/app/eval-app}"
cd "$APP_DIR"

MOD="src/modules/bookmarks"
mkdir -p "$MOD/data" "$MOD/api" "$MOD/migrations"

# ---- data/entities.ts ----
cat > "$MOD/data/entities.ts" <<'TS'
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'bookmarks' })
@Index({ name: 'idx_bookmarks_org_tenant_id', properties: ['organizationId', 'tenantId', 'id'] })
export class Bookmark {
  [OptionalProps]?: 'note' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'url', type: 'text' })
  url!: string

  @Property({ name: 'note', type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
TS

# ---- data/validators.ts ----
cat > "$MOD/data/validators.ts" <<'TS'
import { z } from 'zod'

export const bookmarkCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().url(),
  note: z.string().trim().max(4000).optional(),
})

export const bookmarkUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(500).optional(),
  url: z.string().url().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
})

export const bookmarkListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export type BookmarkCreate = z.infer<typeof bookmarkCreateSchema>
export type BookmarkUpdate = z.infer<typeof bookmarkUpdateSchema>
export type BookmarkList = z.infer<typeof bookmarkListSchema>
TS

# ---- acl.ts ----
cat > "$MOD/acl.ts" <<'TS'
export const features = [
  { id: 'bookmarks.view', title: 'View bookmarks', module: 'bookmarks' },
  { id: 'bookmarks.manage', title: 'Manage bookmarks', module: 'bookmarks', dependsOn: ['bookmarks.view'] },
]

export default features
TS

# ---- api/route.ts (flat /api/bookmarks) ----
cat > "$MOD/api/route.ts" <<'TS'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Bookmark } from '../data/entities'
import { E } from '#generated/entities.ids.generated'
import { bookmarkCreateSchema, bookmarkUpdateSchema, bookmarkListSchema } from '../data/validators'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['bookmarks.view'] },
  POST: { requireAuth: true, requireFeatures: ['bookmarks.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['bookmarks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['bookmarks.manage'] },
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Bookmark,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.bookmarks.bookmark },
  list: {
    schema: bookmarkListSchema,
    entityId: E.bookmarks.bookmark,
    fields: ['id', 'title', 'url', 'note', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
    sortFieldMap: { title: 'title', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.search) filters.title = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: bookmarkCreateSchema,
    mapToEntity: (input) => ({ title: input.title, url: input.url, note: input.note ?? null }),
    response: (entity) => ({ id: entity.id }),
  },
  update: {
    schema: bookmarkUpdateSchema,
    applyToEntity: (entity, input) => {
      if (input.title !== undefined) entity.title = input.title
      if (input.url !== undefined) entity.url = input.url
      if (input.note !== undefined) entity.note = input.note
    },
  },
  del: {},
})
TS

# ---- index.ts ----
cat > "$MOD/index.ts" <<'TS'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'bookmarks',
  title: 'Bookmarks',
  version: '0.1.0',
  description: 'Store and manage bookmarks (title, url, optional note).',
}

export { features } from './acl'
TS

# ---- setup.ts ----
cat > "$MOD/setup.ts" <<'TS'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['bookmarks.view', 'bookmarks.manage'],
    admin: ['bookmarks.view', 'bookmarks.manage'],
    employee: ['bookmarks.view'],
  },
}

export default setup
TS

# ---- register the module in src/modules.ts ----
node - "$APP_DIR/src/modules.ts" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
let src = fs.readFileSync(file, 'utf8')
if (!/id:\s*'bookmarks'/.test(src)) {
  src = src.replace(
    /(export const enabledModules: ModuleEntry\[\] = \[\n)/,
    `$1  { id: 'bookmarks', from: '@app' },\n`,
  )
  fs.writeFileSync(file, src)
}
NODE

# ---- codegen, migration (CLI-generated), apply ----
yarn generate
yarn db:generate
yarn db:migrate
yarn generate

echo "[solve] bookmarks module created and applied."
