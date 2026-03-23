import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSnapshotVersion, resolveSnapshotPublishConfig } from '../snapshot-release.mjs'

test('buildSnapshotVersion increments the patch version for develop snapshots', () => {
  const version = buildSnapshotVersion({
    currentVersion: '0.4.8',
    channel: 'develop',
    buildId: '1523',
    commitSha: 'A1B2C3D4',
  })

  assert.equal(version, '0.4.9-develop.1523.a1b2c3d4')
})

test('buildSnapshotVersion strips an existing prerelease and sanitizes the channel', () => {
  const version = buildSnapshotVersion({
    currentVersion: '0.4.8-canary.12.deadbeef',
    channel: 'Feature/Official_Modules',
    buildId: '20260321',
    commitSha: 'DEADBEEF',
  })

  assert.equal(version, '0.4.9-feature-official-modules.20260321.deadbeef')
})

test('buildSnapshotVersion keeps numeric-only identifiers semver-safe', () => {
  const version = buildSnapshotVersion({
    currentVersion: '0.4.8',
    channel: 'develop',
    buildId: '001523',
    commitSha: '0123456789',
  })

  assert.equal(version, '0.4.9-develop.n001523.g0123456789')
})

test('resolveSnapshotPublishConfig maps develop pushes to the develop tag', () => {
  const config = resolveSnapshotPublishConfig({
    eventName: 'push',
    refName: 'develop',
  })

  assert.deepEqual(config, {
    channel: 'develop',
    publishTag: 'develop',
    movingInstallTarget: '@open-mercato/*@develop',
    releaseKind: 'develop_snapshot',
  })
})

test('resolveSnapshotPublishConfig keeps pull requests on canary previews', () => {
  const config = resolveSnapshotPublishConfig({
    eventName: 'pull_request',
    refName: 'main',
  })

  assert.deepEqual(config, {
    channel: 'canary',
    publishTag: 'canary',
    movingInstallTarget: '',
    releaseKind: 'pr_preview',
  })
})

test('resolveSnapshotPublishConfig rejects unsupported push branches', () => {
  assert.throws(
    () =>
      resolveSnapshotPublishConfig({
        eventName: 'push',
        refName: 'main',
      }),
    /Unsupported snapshot release context: push:main/,
  )
})
