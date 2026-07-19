import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveDocumentCapabilities } from '../lib/capabilities'
import { documentEntityTypeSchema } from '../data/validators'
import eventsConfig from '../events'
import notificationTypes from '../notifications'

const allFeatures = [
  'documents.view',
  'documents.create',
  'documents.edit',
  'documents.delete',
  'documents.share',
  'documents.templates.manage',
] as const

function readModuleSource(relativePath: string): string {
  return readFileSync(join(__dirname, '..', relativePath), 'utf8')
}

describe('M9 capability derivation', () => {
  it('clamps comment, edit, and share on archived documents while keeping view and delete', () => {
    const active = deriveDocumentCapabilities({
      relationshipTier: 'owner',
      userFeatures: allFeatures,
    })
    const archived = deriveDocumentCapabilities({
      relationshipTier: 'owner',
      archived: true,
      userFeatures: allFeatures,
    })
    expect(active.canEdit).toBe(true)
    expect(active.canComment).toBe(true)
    expect(active.canShare).toBe(true)
    expect(archived.canEdit).toBe(false)
    expect(archived.canComment).toBe(false)
    expect(archived.canShare).toBe(false)
    expect(archived.canView).toBe(true)
    expect(archived.canDelete).toBe(true)
  })

  it('grants canArchive to owner tier with the edit feature and keeps it unclamped when archived', () => {
    const owner = deriveDocumentCapabilities({
      relationshipTier: 'owner',
      archived: true,
      userFeatures: ['documents.view', 'documents.edit'],
    })
    expect(owner.canArchive).toBe(true)
  })

  it('grants canArchive through the documents.manage manager override', () => {
    const manager = deriveDocumentCapabilities({
      relationshipTier: null,
      managerOverride: true,
      userFeatures: ['documents.view', 'documents.edit', 'documents.manage'],
    })
    expect(manager.canArchive).toBe(true)
  })

  it('denies canArchive to editor tier and to owners missing the edit feature', () => {
    const editor = deriveDocumentCapabilities({
      relationshipTier: 'editor',
      userFeatures: allFeatures,
    })
    const ownerWithoutEdit = deriveDocumentCapabilities({
      relationshipTier: 'owner',
      userFeatures: ['documents.view'],
    })
    expect(editor.canArchive).toBe(false)
    expect(ownerWithoutEdit.canArchive).toBe(false)
  })

  it('keeps the derivation unchanged when archived is omitted', () => {
    const implicit = deriveDocumentCapabilities({
      relationshipTier: 'editor',
      userFeatures: allFeatures,
    })
    const explicit = deriveDocumentCapabilities({
      relationshipTier: 'editor',
      archived: false,
      userFeatures: allFeatures,
    })
    expect(implicit).toEqual(explicit)
  })
})

describe('M9 entity type registry surface', () => {
  it('accepts the document entity type', () => {
    expect(documentEntityTypeSchema.parse('document')).toBe('document')
  })

  it('keeps every pre-M9 entity type accepted', () => {
    for (const entityType of [
      'customer-person',
      'customer-company',
      'deal',
      'product',
      'catalog-offer',
      'quote',
      'sales-order',
    ]) {
      expect(documentEntityTypeSchema.parse(entityType)).toBe(entityType)
    }
  })
})

describe('M9 event declarations', () => {
  const eventIds = eventsConfig.events.map((event) => event.id)

  it('declares archive lifecycle events with cross-process broadcast', () => {
    for (const eventId of ['documents.document.archived', 'documents.document.unarchived']) {
      const declaration = eventsConfig.events.find((event) => event.id === eventId)
      expect(declaration).toBeDefined()
      expect(declaration?.crossProcessBroadcast).toBe(true)
    }
  })

  it('declares the duplicated event without broadcast', () => {
    const declaration = eventsConfig.events.find((event) => event.id === 'documents.document.duplicated')
    expect(declaration).toBeDefined()
    expect(declaration?.crossProcessBroadcast).toBeUndefined()
  })

  it('keeps every pre-M9 event id declared', () => {
    for (const eventId of [
      'documents.document.created',
      'documents.document.updated',
      'documents.document.deleted',
      'documents.document.shared',
      'documents.document.unshared',
      'documents.comment.created',
      'documents.comment.mentioned',
      'documents.comment.resolved',
      'documents.version.created',
      'documents.version.restored',
      'documents.link.created',
      'documents.link.deleted',
    ]) {
      expect(eventIds).toContain(eventId)
    }
  })
})

describe('M9 notification declarations', () => {
  it('declares the two watch notification types with the three-segment id shape', () => {
    for (const type of ['documents.watch.commented', 'documents.watch.changed']) {
      const declaration = notificationTypes.find((candidate) => candidate.type === type)
      expect(declaration).toBeDefined()
      expect(declaration?.module).toBe('documents')
      expect(declaration?.severity).toBe('info')
      expect(declaration?.actions).toEqual([])
      expect(declaration?.expiresAfterHours).toBe(168)
      expect(type.split('.')).toHaveLength(3)
    }
  })

  it('keeps the mention notification type declared', () => {
    expect(notificationTypes.some((candidate) => candidate.type === 'documents.comment.mentioned')).toBe(true)
  })
})

describe('M9 schema declarations', () => {
  const entitiesSource = readModuleSource(join('data', 'entities.ts'))

  it('declares archived_at on Document', () => {
    expect(entitiesSource).toMatch(/@Property\(\{\s*name:\s*['"]archived_at['"]/)
  })

  it('declares the linked document target with self-link and exactly-one-target checks', () => {
    expect(entitiesSource).toContain('linked_document_id')
    expect(entitiesSource).toMatch(/"document_id" <> "linked_document_id"/)
    expect(entitiesSource).toMatch(/num_nonnulls\("customer_entity_id", "deal_id", "product_id", "catalog_offer_id", "quote_id", "sales_order_id", "linked_document_id"\) = 1/)
  })

  it('declares partial-unique per-user rows for favorites and watchers without updated_at', () => {
    for (const tableName of ['document_favorites', 'document_watchers']) {
      expect(entitiesSource).toContain(`"${tableName}" ("document_id", "user_id") where "deleted_at" is null`)
    }
    for (const className of ['DocumentFavorite', 'DocumentWatcher']) {
      const classStart = entitiesSource.indexOf(`export class ${className}`)
      expect(classStart).toBeGreaterThan(-1)
      const rest = entitiesSource.slice(classStart)
      const nextExport = rest.slice(1).search(/\nexport /)
      const block = nextExport >= 0 ? rest.slice(0, nextExport + 1) : rest
      expect(block).not.toContain('updated_at')
    }
  })

  it('ships the reversible M9 migration with the widened and restored CHECK definitions', () => {
    const migrationSource = readModuleSource(join('migrations', 'Migration20260717000000_documents.ts'))
    expect(migrationSource).toContain('"linked_document_id") = 1')
    expect(migrationSource).toContain('"sales_order_id") = 1')
    expect(migrationSource).toContain('drop table if exists "document_watchers" cascade;')
    expect(migrationSource).toContain('drop table if exists "document_favorites" cascade;')
    expect(migrationSource).toContain('drop column "archived_at"')
  })
})
