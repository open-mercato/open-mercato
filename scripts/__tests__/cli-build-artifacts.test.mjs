import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../../packages/cli/dist/', import.meta.url))

describe('cli build artifacts after package tasks complete', { skip: !existsSync(distDir) }, () => {
  for (const leftover of ['agentic.staging', 'agentic.previous']) {
    it(`leaves no dist/${leftover} behind after a completed build`, () => {
      assert.equal(existsSync(join(distDir, leftover)), false)
    })
  }
})
