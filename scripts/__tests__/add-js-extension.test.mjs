import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { atomicWriteFileSync } from '../lib/add-js-extension.mjs'

test('atomicWriteFileSync preserves mtime for byte-identical output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-stable-'))
  try {
    const filePath = path.join(root, 'dist', 'index.js')
    assert.equal(atomicWriteFileSync(filePath, 'export const value = 1\n'), true)

    const stableTime = new Date('2020-01-01T00:00:00Z')
    fs.utimesSync(filePath, stableTime, stableTime)

    assert.equal(atomicWriteFileSync(filePath, 'export const value = 1\n'), false)
    assert.equal(fs.statSync(filePath).mtimeMs, stableTime.getTime())

    assert.equal(atomicWriteFileSync(filePath, 'export const value = 2\n'), true)
    assert.ok(fs.statSync(filePath).mtimeMs > stableTime.getTime())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
