import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncCommunicationChannelsEnvExample } from '../template-sync.ts'

const header = '# --- Email / Communication Channels (per-user email integration) ---'
const shared = `${header}\n# Updated documentation\n# SHARED_OPTION=\n`
const appOnly = '# --- Monorepo defaults ---\nAPP_ONLY=monorepo\n\n'
const templateOnly = '# --- Standalone defaults ---\nTEMPLATE_ONLY=standalone\n\n'

test('syncs the shared environment example without replacing standalone defaults', () => {
  const stale = `${header}\n# Old documentation\n# SHARED_OPTION=\n\n`
  const trailing = '# --- Logging ---\nLOG_LEVEL=standalone-default\n'
  const source = appOnly + shared
  const expected = templateOnly + shared + '\n' + trailing

  assert.equal(syncCommunicationChannelsEnvExample(source, templateOnly + stale + trailing), expected)
  assert.equal(syncCommunicationChannelsEnvExample(source, expected), expected)
})

test('restores a missing shared section without copying monorepo defaults', () => {
  const expected = templateOnly + '\n' + shared

  assert.equal(syncCommunicationChannelsEnvExample(appOnly + shared, templateOnly), expected)
})

test('refuses to overwrite active standalone configuration inside the shared section', () => {
  const active = `${header}\nSHARED_OPTION=standalone\n`

  assert.throws(
    () => syncCommunicationChannelsEnvExample(appOnly + shared, templateOnly + active),
    /the shared Communication Channels section must contain only comments/,
  )
})
