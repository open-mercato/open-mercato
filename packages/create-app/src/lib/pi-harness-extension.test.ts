import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

const asset = new URL('../../agentic/shared/scripts/pi-harness-extension.mjs', import.meta.url)
const maximumBytes = 256 * 1024

type Content = Array<{ type: string; text?: unknown }>
type Patch = { content?: Content; details?: Record<string, unknown>; structuredContent?: unknown; isError?: boolean }
type Handler = (event: Record<string, unknown>) => Patch | undefined

async function registeredHandler(): Promise<Handler> {
  let handler: Handler = () => undefined
  if (fs.existsSync(asset)) {
    const extension = await import(asset.href)
    extension.default({ on(name: string, registered: Handler) { assert.equal(name, 'tool_result'); handler = registered } })
  }
  return handler
}

function originalRead(text: string): Record<string, unknown> {
  return {
    type: 'tool_result', toolName: 'mcp__harness__read', toolCallId: 'read-1',
    input: { path: '.ai/guides/contracts.md' }, isError: false,
    details: { server: 'harness', tool: 'read', fullOutputPath: '/unreadable/native-output.txt', retained: 'metadata' },
    content: [{ type: 'text', text: `Warning: truncated output\n${text.slice(0, 10240)}…truncated…${text.slice(-10240)}` }],
    structuredContent: { content: [{ type: 'text', text }] },
  }
}

function visible(patch: Patch | undefined, event: Record<string, unknown>): string {
  const content = patch?.content ?? event.content as Content
  return content.map(block => block.text).join('')
}

test('Pi harness delivery restores the exact approved read rather than the native clipped content', async () => {
  const handler = await registeredHandler()
  const text = `head:${'a'.repeat(25000)}MIDDLE_MUST_REACH_MODEL${'z'.repeat(25000)}:tail`
  const event = originalRead(text)
  assert.equal(visible(undefined, event).includes('MIDDLE_MUST_REACH_MODEL'), false)
  const patch = handler(event)
  assert.equal(visible(patch, event), text, 'the model must receive every byte of the successful harness read')
  assert.equal(patch?.isError, false)
  assert.equal(patch?.structuredContent, event.structuredContent)
  assert.equal(patch?.details?.retained, 'metadata')
  assert.deepEqual(patch?.details?.harnessReadDelivery, { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })
  assert.deepEqual(event.input, { path: '.ai/guides/contracts.md' })
})

test('Pi harness delivery preserves small, empty and multibyte reads with exact delivery hashes', async () => {
  const handler = await registeredHandler()
  for (const text of ['', 'small read', '品質 😀 café']) {
    const event = originalRead(text)
    event.content = [{ type: 'text', text }]
    const patch = handler(event)
    assert.equal(visible(patch, event), text)
    assert.deepEqual(patch?.details?.harnessReadDelivery, { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })
  }
})

test('Pi harness delivery accepts the existing server UTF-8 byte boundary and rejects excess bytes', async () => {
  const handler = await registeredHandler()
  const text = '😀'.repeat(maximumBytes / 4)
  const event = originalRead(text)
  assert.equal(visible(handler(event), event), text)
  const oversized = handler(originalRead(text + '😀'))
  assert.equal(oversized?.isError, true, 'unsupported successful read delivery must become an explicit tool error')
  assert.match(visible(oversized, event), /delivery/i)
  assert.equal(oversized?.structuredContent, undefined)
})

test('Pi harness delivery fails closed when a successful exact read lacks one bounded original text block', async () => {
  const handler = await registeredHandler()
  for (const original of [undefined, null, [], {}, { content: [] }, { content: [{ type: 'text', text: 42 }] }, { content: [{ type: 'image', data: 'value' }] }, { content: [{ type: 'resource', resource: {} }] }, { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }, { content: [{ type: 'text', text: 'body' }], isError: 'false' }]) {
    const event = originalRead('READ_BODY_MUST_NOT_LEAK')
    event.structuredContent = original
    const patch = handler(event)
    assert.equal(patch?.isError, true, 'a partial read must not silently masquerade as restored delivery')
    assert.equal(patch?.structuredContent, undefined)
    assert.equal(visible(patch, event).includes('READ_BODY_MUST_NOT_LEAK'), false)
  }
})

test('Pi harness delivery leaves blocked reads, foreign tools, writes and resources unchanged', async () => {
  const handler = await registeredHandler()
  const events = [
    { ...originalRead('body'), isError: true },
    { ...originalRead('body'), structuredContent: { isError: true, content: [{ type: 'text', text: 'blocked' }] } },
    { ...originalRead('body'), toolName: 'mcp__harness__write' },
    { ...originalRead('body'), toolName: 'mcp__harness__read_mcp_resource' },
    { ...originalRead('body'), toolName: 'read' },
    { ...originalRead('body'), details: { server: 'other', tool: 'read' } },
    { ...originalRead('body'), details: { server: 'harness', tool: 'write' } },
    { ...originalRead('body'), details: undefined },
    { ...originalRead('body'), isError: undefined },
  ]
  for (const event of events) {
    const before = structuredClone(event)
    assert.equal(handler(event), undefined)
    assert.deepEqual(event, before)
  }
})
