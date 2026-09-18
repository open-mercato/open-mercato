import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  assertProductionBuildArtifacts,
  STANDALONE_PRODUCTION_BUILD_ARTIFACTS,
} from '../lib/standalone-build-artifacts.mjs'

// A guard that cannot fail is indistinguishable from a guard that does not run. The
// integration harness this backs needs Verdaccio, Docker and a full scaffold, so it never
// executes in CI — these cases keep the assertion logic itself honest there.

function createAppDir(artifacts) {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-standalone-artifacts-'))
  const distDir = path.join(appDir, '.mercato', 'next')
  for (const relativePath of artifacts) {
    const filePath = path.join(distDir, ...relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '')
  }
  return appDir
}

const ALL_ARTIFACTS = STANDALONE_PRODUCTION_BUILD_ARTIFACTS.map((artifact) => artifact.relativePath)

test('passes when every production build artifact is present', () => {
  const appDir = createAppDir(ALL_ARTIFACTS)
  try {
    assert.doesNotThrow(() => assertProductionBuildArtifacts(appDir))
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true })
  }
})

test('throws when the build id is missing', () => {
  const appDir = createAppDir(ALL_ARTIFACTS.filter((relativePath) => relativePath[0] !== 'BUILD_ID'))
  try {
    assert.throws(
      () => assertProductionBuildArtifacts(appDir),
      /Standalone production build produced a build id is missing/,
    )
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true })
  }
})

test('throws when /_global-error was not prerendered', () => {
  const appDir = createAppDir(ALL_ARTIFACTS.filter((relativePath) => !relativePath.includes('_global-error.html')))
  try {
    assert.throws(
      () => assertProductionBuildArtifacts(appDir),
      /Standalone production build prerendered \/_global-error/,
    )
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true })
  }
})

test('throws when the build never produced a dist directory', () => {
  const appDir = createAppDir([])
  try {
    assert.throws(() => assertProductionBuildArtifacts(appDir), /is missing/)
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true })
  }
})

test('reports every checked artifact on success', () => {
  const reported = []
  assertProductionBuildArtifacts('/nonexistent', {
    exists: () => true,
    onSuccess: (label) => reported.push(label),
  })

  assert.deepEqual(reported, STANDALONE_PRODUCTION_BUILD_ARTIFACTS.map((artifact) => artifact.label))
})

test('names the Next-internal coupling so an upgrade failure is signposted', () => {
  const globalErrorArtifact = STANDALONE_PRODUCTION_BUILD_ARTIFACTS.find((artifact) =>
    artifact.relativePath.includes('_global-error.html'),
  )

  assert.ok(globalErrorArtifact, 'the /_global-error artifact is still asserted')
  assert.match(globalErrorArtifact.label, /Next-internal/)
})
