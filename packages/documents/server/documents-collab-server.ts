import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  onAuthenticatePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
  Server as HocuspocusServer,
} from '@hocuspocus/server'
import * as Y from 'yjs'
import { verifyCollabToken, type CollabTokenClaims } from '@open-mercato/documents/modules/documents/lib/collabToken'
import {
  loadDocumentContent,
  persistDocumentContent,
  type PersistDocumentContentDeps,
} from '@open-mercato/documents/modules/documents/lib/contentService'
import { htmlToYDoc, yDocToContent } from '@open-mercato/documents/modules/documents/lib/collabMaterializer'

export { htmlToYDoc, yDocToContent }

export type CollabConnection = { readOnly: boolean }
type CollabTier = CollabTokenClaims['tier']
export type CollabContext = {
  userId: string
  tenantId: string
  organizationId: string
  tier: CollabTier
}
type CollabScope = { tenantId: string; organizationId: string }
type CollabContainer = { resolve: (name: string) => unknown }
export type CollabHooksDeps = {
  verifyToken: (token: string) => CollabTokenClaims | null
  resolveContainer: () => Promise<CollabContainer>
  loadContent: (
    em: unknown,
    documentId: string,
    scope: CollabScope,
  ) => Promise<{ yjsState: Buffer | null; contentHtml: string | null } | null>
  persistContent: (
    em: unknown,
    documentId: string,
    scope: CollabScope,
    input: { yjsState: Buffer; contentHtml?: string | null; contentText?: string | null },
    deps: { searchIndexer: unknown },
  ) => Promise<void>
  allowedOrigins?: string[] | null
  isRoomClosing?: (documentName: string) => boolean
}

type RequestHeaders = Record<string, string | string[] | undefined>

function readHeader(headers: RequestHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function assertScopedContext(context: CollabContext | null | undefined): asserts context is CollabContext {
  if (!context?.tenantId || !context.organizationId) {
    throw new Error('[internal] documents collab: missing tenant scope')
  }
}

function isReadOnlyTier(tier: CollabTier): boolean {
  return tier === 'viewer' || tier === 'commenter'
}

function toContext(claims: CollabTokenClaims): CollabContext {
  return {
    userId: claims.userId,
    tenantId: claims.tenantId,
    organizationId: claims.organizationId,
    tier: claims.tier,
  }
}

export function createCollabHooks(deps: CollabHooksDeps) {
  const materializationWarningRooms = new Set<string>()

  return {
    async onAuthenticate(data: {
      token?: string
      documentName: string
      connection: CollabConnection
      requestHeaders?: RequestHeaders
    }): Promise<CollabContext> {
      if (deps.allowedOrigins?.length) {
        const origin = readHeader(data.requestHeaders, 'origin')
        if (origin && !deps.allowedOrigins.includes(origin)) {
          throw new Error('[internal] documents collab: origin not allowed')
        }
      }

      const claims = deps.verifyToken(data.token ?? '')
      if (!claims) {
        throw new Error('[internal] documents collab: invalid token')
      }
      if (claims.documentId !== data.documentName) {
        throw new Error('[internal] documents collab: room mismatch')
      }

      data.connection.readOnly = isReadOnlyTier(claims.tier)
      return toContext(claims)
    },

    async onLoadDocument(data: {
      documentName: string
      context: CollabContext
      document: Y.Doc
    }): Promise<Y.Doc> {
      assertScopedContext(data.context)

      const container = await deps.resolveContainer()
      const em = container.resolve('em')
      const scope = {
        tenantId: data.context.tenantId,
        organizationId: data.context.organizationId,
      }
      const content = await deps.loadContent(em, data.documentName, scope)

      if (content?.yjsState && content.yjsState.length > 0) {
        Y.applyUpdate(data.document, new Uint8Array(content.yjsState))
        return data.document
      }

      if (content?.contentHtml) {
        const tempDoc = htmlToYDoc(content.contentHtml)
        Y.applyUpdate(data.document, Y.encodeStateAsUpdate(tempDoc))
      }

      return data.document
    },

    async onStoreDocument(data: {
      documentName: string
      context: CollabContext
      document: Y.Doc
    }): Promise<void> {
      assertScopedContext(data.context)
      if (deps.isRoomClosing?.(data.documentName)) return
      if (isReadOnlyTier(data.context.tier)) return

      const materialized = yDocToContent(data.document)
      if (materialized) materializationWarningRooms.delete(data.documentName)
      if (!materialized && !materializationWarningRooms.has(data.documentName)) {
        materializationWarningRooms.add(data.documentName)
        console.warn(`[documents-collab] materialization failed for room ${data.documentName}; preserving previous html/text`)
      }
      const container = await deps.resolveContainer()
      const em = container.resolve('em')
      const searchIndexer = container.resolve('searchIndexer')
      const yjsState = Buffer.from(Y.encodeStateAsUpdate(data.document))

      await deps.persistContent(
        em,
        data.documentName,
        { tenantId: data.context.tenantId, organizationId: data.context.organizationId },
        materialized
          ? {
              yjsState,
              contentHtml: materialized.html,
              contentText: materialized.text,
            }
          : { yjsState },
        { searchIndexer },
      )
    },
  }
}

function headersToRecord(headers: Headers): RequestHeaders {
  return { origin: headers.get('origin') ?? undefined }
}

function eventDocumentId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const id = record.documentId ?? record.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  return Boolean(entry && import.meta.url === pathToFileURL(resolve(entry)).href)
}

export async function main(): Promise<void> {
  const [
    { Server },
    { bootstrapFromAppRoot },
    { createRequestContainer },
    { registerCrossProcessEventListener },
  ] = await Promise.all([
    import('@hocuspocus/server'),
    import('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
    import('@open-mercato/shared/lib/di/container'),
    import('@open-mercato/events'),
  ])

  const appRoot = process.env.DOCUMENTS_COLLAB_APP_ROOT || undefined
  await bootstrapFromAppRoot(appRoot)

  const port = Number(process.env.DOCUMENTS_COLLAB_PORT || 4101)
  const allowedOrigins = (process.env.DOCUMENTS_COLLAB_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const closingRooms = new Set<string>()
  const hooks = createCollabHooks({
    verifyToken: verifyCollabToken,
    resolveContainer: () => createRequestContainer(),
    loadContent: async (em, id, scope) => {
      const content = await loadDocumentContent(em as EntityManager, id, scope)
      if (!content) return null
      return {
        yjsState: content.yjsState ?? null,
        contentHtml: content.contentHtml ?? null,
      }
    },
    persistContent: (em, id, scope, input, serviceDeps) => persistDocumentContent(
      em as EntityManager,
      id,
      scope,
      input,
      serviceDeps as PersistDocumentContentDeps,
    ),
    allowedOrigins,
    isRoomClosing: (name) => closingRooms.has(name),
  })

  const server: HocuspocusServer<CollabContext> = new Server<CollabContext>({
    port,
    async onAuthenticate(data: onAuthenticatePayload<CollabContext>) {
      return await hooks.onAuthenticate({
        token: data.token,
        documentName: data.documentName,
        connection: data.connectionConfig,
        requestHeaders: headersToRecord(data.requestHeaders),
      })
    },
    async onLoadDocument(data: onLoadDocumentPayload<CollabContext>) {
      return await hooks.onLoadDocument({
        documentName: data.documentName,
        context: data.context,
        document: data.document,
      })
    },
    async onStoreDocument(data: onStoreDocumentPayload<CollabContext>) {
      return await hooks.onStoreDocument({
        documentName: data.documentName,
        context: data.lastContext,
        document: data.document,
      })
    },
  })

  await server.listen()

  const forceCloseEvents = new Set([
    'documents.document.deleted',
    'documents.document.unshared',
    'documents.document.shared',
    'documents.version.restored',
  ])
  registerCrossProcessEventListener((envelope: { event: string; payload: unknown }) => {
    if (!forceCloseEvents.has(envelope.event)) return
    const documentId = eventDocumentId(envelope.payload)
    if (!documentId) return

    closingRooms.add(documentId)
    try {
      server.hocuspocus.closeConnections(documentId)
    } finally {
      setTimeout(() => closingRooms.delete(documentId), 5000)
    }
  })

  console.log(`[documents-collab] listening on :${port}`)
}

if (process.env.DOCUMENTS_COLLAB_START !== 'off' && isMainModule()) {
  void main().catch((error: unknown) => {
    console.error('[documents-collab] failed to start', error)
    process.exitCode = 1
  })
}
