import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  buildGhInstallMessage,
  classifyRepoState,
  detectGitRepoFlowState,
  isGitRepoFlowEnabled,
  parseGitHubRemoteUrl,
  planLocalRepoBootstrap,
  runGitRepoPublishAction,
} from '../../template/scripts/dev-splash-git-repo-flow.mjs'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

test('git repo flow env flag defaults to enabled and supports false tokens', () => {
  assert.equal(isGitRepoFlowEnabled(undefined), true)
  assert.equal(isGitRepoFlowEnabled('false'), false)
  assert.equal(isGitRepoFlowEnabled('off'), false)
  assert.equal(isGitRepoFlowEnabled('0'), false)
  assert.equal(isGitRepoFlowEnabled('true'), true)
})

test('parses GitHub remotes and classifies repository states', () => {
  assert.deepEqual(parseGitHubRemoteUrl('https://github.com/open-mercato/example.git'), {
    owner: 'open-mercato',
    repo: 'example',
    url: 'https://github.com/open-mercato/example',
  })
  assert.deepEqual(parseGitHubRemoteUrl('git@github.com:open-mercato/example.git'), {
    owner: 'open-mercato',
    repo: 'example',
    url: 'https://github.com/open-mercato/example',
  })
  assert.equal(classifyRepoState({ hasGitDir: false, originUrl: null }), 'missing')
  assert.equal(classifyRepoState({ hasGitDir: true, originUrl: null }), 'local_only')
  assert.equal(classifyRepoState({ hasGitDir: true, originUrl: 'https://github.com/open-mercato/example.git' }), 'github_remote')
  assert.equal(classifyRepoState({ hasGitDir: true, originUrl: 'https://gitlab.com/open-mercato/example.git' }), 'other_remote')
})

test('plans local bootstrap steps based on git state', () => {
  assert.deepEqual(planLocalRepoBootstrap({ repoState: 'missing', hasCommits: false }), {
    shouldInit: true,
    shouldCreateInitialCommit: true,
  })
  assert.deepEqual(planLocalRepoBootstrap({ repoState: 'local_only', hasCommits: false }), {
    shouldInit: false,
    shouldCreateInitialCommit: true,
  })
  assert.deepEqual(planLocalRepoBootstrap({ repoState: 'local_only', hasCommits: true }), {
    shouldInit: false,
    shouldCreateInitialCommit: false,
  })
})

test('detects missing gh and returns install guidance', async () => {
  const targetDir = makeTempDir('create-app-git-flow-missing-gh-')
  try {
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ name: 'demo-store' }))

    const state = await detectGitRepoFlowState({
      launchDir: targetDir,
      env: { PATH: '' },
      platform: 'darwin',
      runCommand: async () => ({ code: 1, signal: null, stdout: '', stderr: '' }),
    })

    assert.equal(state.repoState, 'missing')
    assert.equal(state.ghStatus, 'missing')
    assert.equal(state.defaultRepoName, 'demo-store')
    assert.equal(state.message, buildGhInstallMessage('darwin'))
    assert.match(state.message, /brew install gh/)
  } finally {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

test('detects authenticated gh owner options for a local-only repo', async () => {
  const targetDir = makeTempDir('create-app-git-flow-authenticated-')
  const binDir = join(targetDir, 'bin')
  try {
    mkdirSync(join(targetDir, '.git'), { recursive: true })
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'gh'), '#!/bin/sh\n')
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ name: 'demo-store' }))

    const state = await detectGitRepoFlowState({
      launchDir: targetDir,
      env: { PATH: binDir },
      platform: 'darwin',
      runCommand: async (command: string, args: string[]) => {
        if (command === 'git' && args.join(' ') === 'remote get-url origin') {
          return { code: 2, signal: null, stdout: '', stderr: 'no remote' }
        }
        if (command === 'git' && args.join(' ') === 'rev-parse --verify HEAD') {
          return { code: 0, signal: null, stdout: 'abc123\n', stderr: '' }
        }
        if (args.join(' ') === 'auth status --active --hostname github.com') {
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        if (args.join(' ') === 'api /user') {
          return { code: 0, signal: null, stdout: JSON.stringify({ login: 'pkarw' }), stderr: '' }
        }
        if (args.join(' ') === 'api /user/orgs') {
          return { code: 0, signal: null, stdout: JSON.stringify([{ login: 'open-mercato' }]), stderr: '' }
        }
        return { code: 0, signal: null, stdout: '', stderr: '' }
      },
    })

    assert.equal(state.repoState, 'local_only')
    assert.equal(state.ghStatus, 'available')
    assert.equal(state.authStatus, 'authenticated')
    assert.deepEqual(state.ownerOptions, ['pkarw', 'open-mercato'])
    assert.equal(state.defaultOwner, 'pkarw')
  } finally {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

test('publishes a missing repository after gh login by initializing git and creating the first commit', async () => {
  const targetDir = makeTempDir('create-app-git-flow-publish-missing-')
  const binDir = join(targetDir, 'bin')
  const commands: string[] = []
  let authenticated = false
  let hasCommits = false
  let remoteUrl: string | null = null

  try {
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'gh'), '#!/bin/sh\n')
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ name: 'demo-store' }))

    const result = await runGitRepoPublishAction({
      launchDir: targetDir,
      env: { PATH: binDir },
      platform: 'darwin',
      runCommand: async (command: string, args: string[]) => {
        commands.push([command, ...args].join(' '))
        if (args.join(' ') === 'auth status --active --hostname github.com') {
          return { code: authenticated ? 0 : 1, signal: null, stdout: '', stderr: '' }
        }
        if (args.join(' ') === 'auth login --web --git-protocol https') {
          authenticated = true
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        if (command === 'git' && args.join(' ') === 'remote get-url origin') {
          return remoteUrl
            ? { code: 0, signal: null, stdout: `${remoteUrl}\n`, stderr: '' }
            : { code: 2, signal: null, stdout: '', stderr: 'no remote' }
        }
        if (command === 'git' && args.join(' ') === 'rev-parse --verify HEAD') {
          return hasCommits
            ? { code: 0, signal: null, stdout: 'abc123\n', stderr: '' }
            : { code: 128, signal: null, stdout: '', stderr: 'missing head' }
        }
        if (command === 'git' && args.join(' ') === 'init -b main') {
          mkdirSync(join(targetDir, '.git'), { recursive: true })
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        if (command === 'git' && args.join(' ') === 'add -A') {
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        if (command === 'git' && args.join(' ') === 'commit -m Initial commit') {
          hasCommits = true
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        if (args[0] === 'api' && args[1] === '/user') {
          return { code: 0, signal: null, stdout: JSON.stringify({ login: 'pkarw' }), stderr: '' }
        }
        if (args[0] === 'api' && args[1] === '/user/orgs') {
          return { code: 0, signal: null, stdout: '[]', stderr: '' }
        }
        if (args[0] === 'repo' && args[1] === 'create') {
          remoteUrl = 'https://github.com/pkarw/demo-store.git'
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        return { code: 0, signal: null, stdout: '', stderr: '' }
      },
    })

    assert.equal(result.repoUrl, 'https://github.com/pkarw/demo-store')
    assert.equal(result.repoState, 'github_remote')
    assert.equal(result.owner, 'pkarw')
    assert.equal(result.repoName, 'demo-store')
    assert.equal(commands.includes('git init -b main'), true)
    assert.equal(commands.includes('git add -A'), true)
    assert.equal(commands.includes('git commit -m Initial commit'), true)
    assert.equal(commands.some((entry) => entry.includes('gh repo create pkarw/demo-store --private --source . --remote origin --push')), true)
  } finally {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

test('publishes an existing local-only repository without reinitializing git or creating a new commit', async () => {
  const targetDir = makeTempDir('create-app-git-flow-publish-local-only-')
  const binDir = join(targetDir, 'bin')
  const commands: string[] = []
  let remoteUrl: string | null = null

  try {
    mkdirSync(join(targetDir, '.git'), { recursive: true })
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'gh'), '#!/bin/sh\n')
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ name: 'demo-store' }))

    const result = await runGitRepoPublishAction({
      launchDir: targetDir,
      env: { PATH: binDir },
      platform: 'darwin',
      runCommand: async (command: string, args: string[]) => {
        commands.push([command, ...args].join(' '))
        if (args.join(' ') === 'auth status --active --hostname github.com') {
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        if (command === 'git' && args.join(' ') === 'remote get-url origin') {
          return remoteUrl
            ? { code: 0, signal: null, stdout: `${remoteUrl}\n`, stderr: '' }
            : { code: 2, signal: null, stdout: '', stderr: 'no remote' }
        }
        if (command === 'git' && args.join(' ') === 'rev-parse --verify HEAD') {
          return { code: 0, signal: null, stdout: 'abc123\n', stderr: '' }
        }
        if (args[0] === 'api' && args[1] === '/user') {
          return { code: 0, signal: null, stdout: JSON.stringify({ login: 'pkarw' }), stderr: '' }
        }
        if (args[0] === 'api' && args[1] === '/user/orgs') {
          return { code: 0, signal: null, stdout: '[]', stderr: '' }
        }
        if (args[0] === 'repo' && args[1] === 'create') {
          remoteUrl = 'https://github.com/pkarw/demo-store.git'
          return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        return { code: 0, signal: null, stdout: '', stderr: '' }
      },
    })

    assert.equal(result.repoUrl, 'https://github.com/pkarw/demo-store')
    assert.equal(commands.includes('git init -b main'), false)
    assert.equal(commands.includes('git add -A'), false)
    assert.equal(commands.includes('git commit -m Initial commit'), false)
    assert.equal(commands.some((entry) => entry.includes('gh repo create pkarw/demo-store --private --source . --remote origin --push')), true)
  } finally {
    rmSync(targetDir, { recursive: true, force: true })
  }
})
