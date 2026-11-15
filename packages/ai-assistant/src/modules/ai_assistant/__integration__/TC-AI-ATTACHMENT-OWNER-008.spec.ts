import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { NextRequest } from 'next/server'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'
import {
  OWNER_ACCESS_FEATURES,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
  type AttachmentRowSnapshot,
  type OwnerAccessActor,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  deleteFakeLlmUsageInDb,
  startFakeLlmServer,
  withFakeLlmEnvironment,
  type FakeLlmServer,
} from './helpers/fakeLlmServer'

export const integrationMeta = { dependsOnModules: ['documents', 'catalog', 'workflows'] }

const CHAT_AGENT_ID = 'catalog.catalog_assistant'
const OBJECT_AGENT_ID = 'workflows.workflow_author'
const FAKE_ANSWER = 'om-fake-answer'
const WORKFLOW_DRAFT = {
  summary: 'Fake draft',
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [{ transitionId: 'start-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
}

type RoutePost = (request: NextRequest) => Promise<Response>
type Runtime = { chat: RoutePost; runObject: RoutePost; buildRequest: (path: string, token: string, body: unknown) => NextRequest }

async function loadRuntime(): Promise<Runtime> {
  const { installNextSubpathResolveHook } = await importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook')>('@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook')
  installNextSubpathResolveHook()
  const [{ bootstrapFromAppRoot }, nextServer, chat, runObject] = await Promise.all([
    importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')>('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
    importFromAppRuntime<typeof import('next/server.js')>('next/server.js'),
    importFromAppRuntime<typeof import('@open-mercato/ai-assistant/modules/ai_assistant/api/ai/chat/route')>('@open-mercato/ai-assistant/modules/ai_assistant/api/ai/chat/route'),
    importFromAppRuntime<typeof import('@open-mercato/ai-assistant/modules/ai_assistant/api/ai/run-object/route')>('@open-mercato/ai-assistant/modules/ai_assistant/api/ai/run-object/route'),
  ])
  await bootstrapFromAppRoot(resolveAppRoot())
  const origin = process.env.BASE_URL?.trim() || 'http://localhost:3000'
  return {
    chat: chat.POST,
    runObject: runObject.POST,
    buildRequest: (path, token, body) => new nextServer.NextRequest(new URL(path, origin), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

/**
 * TC-AI-ATTACHMENT-OWNER-008: `POST /api/ai_assistant/ai/chat` and
 * `POST /api/ai_assistant/ai/run-object` run in-process against the app's
 * database with the model provider pointed at a local OpenAI-compatible fake
 * that records every request. A turn carries a file of a document shared with
 * one user, a file of a hidden document, an unprotected library file, and copies
 * of a library file and of a Documents file in another organization and in
 * another tenant. The recorded model requests contain the content of the shared
 * document's file only for the user it is shared with, always contain the
 * library file, and never contain the hidden file or a foreign-scope copy (name,
 * content or id). Every attachment row is unchanged.
 */
test('TC-AI-ATTACHMENT-OWNER-008: chat and run-object send only attachments the caller may read to the model', async ({ request }) => {
  test.slow()
  const llm: FakeLlmServer = await startFakeLlmServer({ text: FAKE_ANSWER, object: () => WORKFLOW_DRAFT })
  try {
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [
          ...OWNER_ACCESS_FEATURES, 'ai_assistant.view',
          'catalog.products.view', 'catalog.categories.view', 'workflows.definitions.create',
        ],
      })
      const label = (name: string) => `${fixture.prefix}-${name}`
      const allowed = await fixture.upload(fixture.visible, 'allowed')
      const hidden = await fixture.upload(fixture.hidden, 'hidden')
      const library = await fixture.upload(randomUUID(), 'library', { entityId: 'attachments:library' })
      const foreignDocumentSource = await fixture.upload(fixture.visible, 'foreign-document')
      const foreignLibrarySource = await fixture.upload(randomUUID(), 'foreign-library', { entityId: 'attachments:library' })
      const foreign = [
        await fixture.foreignCopy(foreignDocumentSource, 'organization', { recordId: fixture.visible }),
        await fixture.foreignCopy(foreignDocumentSource, 'tenant', { recordId: fixture.visible }),
        await fixture.foreignCopy(foreignLibrarySource, 'organization'),
        await fixture.foreignCopy(foreignLibrarySource, 'tenant'),
      ].map((row) => row.id)
      const attachmentIds = [allowed, hidden, library, ...foreign]
      const tracked = [...attachmentIds, foreignDocumentSource, foreignLibrarySource]
      const before = new Map<string, AttachmentRowSnapshot | null>()
      for (const id of tracked) before.set(id, await readAttachmentRowInDb(id))
      expect((await readAttachmentRowInDb(allowed))?.content, 'the uploaded text is extracted at upload').toBe(`${label('allowed')}-content`)

      const runtime = await loadRuntime()
      const messages = [{ id: randomUUID(), role: 'user' as const, content: 'Summarize the attached files.' }]
      const sentToModel = () => llm.requests.filter((entry) => entry.path.endsWith('/chat/completions')).map((entry) => entry.raw).join('\n')
      const expectModelSaw = (raw: string, canReadAllowed: boolean, surface: string) => {
        expect(raw, `${surface}: the model is called`).not.toBe('')
        expect(raw, `${surface}: the unprotected library file reaches the model`).toContain(`${label('library')}-content`)
        if (canReadAllowed) expect(raw, `${surface}: the shared document's file reaches the model`).toContain(`${label('allowed')}-content`)
        else expect(raw, `${surface}: the shared document's file is withheld`).not.toContain(label('allowed'))
        for (const denied of ['hidden', 'foreign-document', 'foreign-library']) {
          expect(raw, `${surface}: ${denied} never reaches the model`).not.toContain(label(denied))
        }
        for (const id of [hidden, ...foreign, ...(canReadAllowed ? [] : [allowed])]) {
          expect(raw, `${surface}: denied id ${id} never reaches the model`).not.toContain(id)
        }
      }
      const runTurns = async (actor: OwnerAccessActor, canReadAllowed: boolean) => {
        const token = await actor.refreshToken()
        llm.reset()
        const chat = await runtime.chat(runtime.buildRequest(
          `/api/ai_assistant/ai/chat?agent=${CHAT_AGENT_ID}`, token, { messages, attachmentIds },
        ))
        const stream = await chat.text()
        expect(chat.status, `chat answered: ${stream.slice(0, 500)}`).toBe(200)
        expect(stream, 'the streamed answer comes from the fake model').toContain(FAKE_ANSWER)
        expectModelSaw(sentToModel(), canReadAllowed, 'chat')

        llm.reset()
        const object = await runtime.runObject(runtime.buildRequest(
          '/api/ai_assistant/ai/run-object', token, { agent: OBJECT_AGENT_ID, messages, attachmentIds },
        ))
        const body = await object.json() as { object?: unknown; error?: string }
        expect(object.status, `run-object answered: ${JSON.stringify(body)}`).toBe(200)
        expect(body.object).toEqual(WORKFLOW_DRAFT)
        expectModelSaw(sentToModel(), canReadAllowed, 'run-object')
      }

      try {
        await withFakeLlmEnvironment(llm, async () => {
          await runTurns(fixture.recipient, true)
          await runTurns(fixture.unshared, false)
        })
      } finally {
        await deleteFakeLlmUsageInDb()
      }
      for (const id of tracked) expect(await readAttachmentRowInDb(id), `row ${id} is unchanged`).toEqual(before.get(id))
    })
  } finally {
    await llm.close()
  }
})
