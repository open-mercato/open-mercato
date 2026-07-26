import { z } from 'zod'
import { attachOpenApiDocsToModules } from '../attach-docs'
import { buildOpenApiDocument } from '../generator'
import type { ApiRouteManifestEntry, Module } from '../../../modules/registry'

const inviteSchema = z.object({ email: z.string().email(), roleIds: z.array(z.string()) })

const routeFileOpenApi = {
  methods: {
    POST: {
      summary: 'Invite user',
      requestBody: { schema: inviteSchema, description: 'Invitation payload' },
    },
  },
}

const legacyOpenApi = {
  summary: 'Legacy create',
  requestBody: { schema: z.object({ name: z.string() }) },
}

function makeModules(): Module[] {
  return [
    {
      id: 'customer_accounts',
      apis: [
        {
          path: '/customer_accounts/admin/users-invite',
          metadata: { POST: { requireAuth: true } },
          handlers: { POST: async () => new Response(null) },
        },
        {
          method: 'POST',
          path: '/customer_accounts/legacy-create',
          handler: async () => new Response(null),
        },
      ],
    } as unknown as Module,
  ]
}

const manifests: ApiRouteManifestEntry[] = [
  {
    moduleId: 'customer_accounts',
    kind: 'route-file',
    path: '/customer_accounts/admin/users-invite',
    methods: ['POST'],
    load: async () => ({ openApi: routeFileOpenApi }),
  },
  {
    moduleId: 'customer_accounts',
    kind: 'legacy',
    method: 'POST',
    path: '/customer_accounts/legacy-create',
    methods: ['POST'],
    load: async () => ({ openApi: legacyOpenApi }),
  },
]

describe('attachOpenApiDocsToModules', () => {
  it('re-attaches route docs the runtime registry omits, restoring request bodies (#4361)', async () => {
    const bare = buildOpenApiDocument(makeModules())
    const barePost = bare.paths['/customer_accounts/admin/users-invite']?.post as Record<string, any>
    expect(barePost.requestBody).toBeUndefined()

    const enriched = await attachOpenApiDocsToModules(makeModules(), manifests)
    const doc = buildOpenApiDocument(enriched)

    const post = doc.paths['/customer_accounts/admin/users-invite']?.post as Record<string, any>
    expect(post.summary).toBe('Invite user')
    const bodySchema = post.requestBody?.content?.['application/json']?.schema
    expect(bodySchema?.properties?.email).toBeDefined()
    expect(bodySchema?.required).toContain('email')

    const legacyPost = doc.paths['/customer_accounts/legacy-create']?.post as Record<string, any>
    expect(legacyPost.summary).toBe('Legacy create')
    expect(legacyPost.requestBody?.content?.['application/json']?.schema?.properties?.name).toBeDefined()
  })

  it('keeps entries untouched when no manifest matches or loading fails', async () => {
    const failing: ApiRouteManifestEntry[] = [
      {
        moduleId: 'customer_accounts',
        kind: 'route-file',
        path: '/customer_accounts/admin/users-invite',
        methods: ['POST'],
        load: async () => {
          throw new Error('boom')
        },
      },
    ]
    const enriched = await attachOpenApiDocsToModules(makeModules(), failing)
    const apis = enriched[0].apis ?? []
    expect((apis[0] as { docs?: unknown }).docs).toBeUndefined()
    expect((apis[1] as { docs?: unknown }).docs).toBeUndefined()
  })

  it('does not overwrite docs that are already present', async () => {
    const modules = makeModules()
    const existingDocs = { methods: { POST: { summary: 'Existing' } } }
    ;(modules[0].apis?.[0] as { docs?: unknown }).docs = existingDocs
    const enriched = await attachOpenApiDocsToModules(modules, manifests)
    expect((enriched[0].apis?.[0] as { docs?: unknown }).docs).toBe(existingDocs)
  })
})
