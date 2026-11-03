import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { requirePackageBuild } from './package-build-artifacts.js'

// The guard exists for the message it throws: once no test file spawns the build itself (#5059),
// running a single file on an unbuilt tree used to die with a bare ENOENT on a fact-sheet. Only the
// satisfied branch is exercised by the suite, because the `test` script builds first — so the branch
// that carries the whole point of the helper is pinned here, the way its sibling
// describeMissingSiblingBuild is pinned by sibling-build.test.ts.

function withTemporaryPackageRoot(run: (packageRoot: string) => void): void {
  const packageRoot = fs.mkdtempSync(join(os.tmpdir(), 'create-app-build-artifacts-'))
  try {
    run(packageRoot)
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true })
  }
}

test('an unbuilt package root names both missing artifacts and the command that produces them', () => {
  withTemporaryPackageRoot((packageRoot) => {
    assert.throws(
      () => requirePackageBuild(packageRoot),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, new RegExp(escapeForPattern(join('dist', 'index.js'))))
        assert.match(error.message, new RegExp(escapeForPattern(join('dist', 'agentic'))))
        assert.match(error.message, /yarn workspace create-mercato-app build/)
        return true
      },
    )
  })
})

test('a half-built package root names only what is actually missing', () => {
  withTemporaryPackageRoot((packageRoot) => {
    fs.mkdirSync(join(packageRoot, 'dist'), { recursive: true })
    fs.writeFileSync(join(packageRoot, 'dist', 'index.js'), '')

    assert.throws(
      () => requirePackageBuild(packageRoot),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, new RegExp(escapeForPattern(join('dist', 'index.js'))))
        assert.match(error.message, new RegExp(escapeForPattern(join('dist', 'agentic'))))
        return true
      },
    )
  })
})

test('a built package root passes silently', () => {
  withTemporaryPackageRoot((packageRoot) => {
    fs.mkdirSync(join(packageRoot, 'dist', 'agentic'), { recursive: true })
    fs.writeFileSync(join(packageRoot, 'dist', 'index.js'), '')

    assert.doesNotThrow(() => requirePackageBuild(packageRoot))
  })
})

function escapeForPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
