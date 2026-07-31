import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPersistentSysctlConfig,
  buildSysctlAssignments,
  detectWsl,
  ensureDevInotifyLimits,
  findInotifyLimitIssues,
  mergeVsCodeWatcherExcludes,
  readCurrentInotifyLimits,
} from '../dev-inotify-limits.mjs'

function createProcReader(files) {
  return (filePath) => {
    if (Object.hasOwn(files, filePath)) {
      return files[filePath]
    }
    throw new Error(`ENOENT: ${filePath}`)
  }
}

const healthyProcFiles = {
  '/proc/sys/kernel/osrelease': '6.6.87.2-microsoft-standard-WSL2\n',
  '/proc/sys/fs/inotify/max_user_watches': '4194304\n',
  '/proc/sys/fs/inotify/max_user_instances': '4096\n',
  '/proc/sys/fs/inotify/max_queued_events': '65536\n',
}

test('detectWsl recognizes Microsoft kernel markers on Linux', () => {
  assert.equal(detectWsl({
    platform: 'linux',
    readFileSync: createProcReader(healthyProcFiles),
  }), true)
  assert.equal(detectWsl({
    platform: 'darwin',
    readFileSync: createProcReader(healthyProcFiles),
  }), false)
})

test('readCurrentInotifyLimits reads numeric proc values', () => {
  const result = readCurrentInotifyLimits({
    readFileSync: createProcReader(healthyProcFiles),
  })

  assert.deepEqual(result.values, {
    max_user_watches: 4194304,
    max_user_instances: 4096,
    max_queued_events: 65536,
  })
  assert.deepEqual(result.errors, {})
})

test('findInotifyLimitIssues flags WSL defaults that are too low for this repo', () => {
  const issues = findInotifyLimitIssues({
    max_user_watches: 524288,
    max_user_instances: 128,
    max_queued_events: 16384,
  })

  assert.deepEqual(issues.map((issue) => issue.name), [
    'max_user_watches',
    'max_user_instances',
    'max_queued_events',
  ])
  assert.deepEqual(buildSysctlAssignments(issues), [
    'fs.inotify.max_user_watches=4194304',
    'fs.inotify.max_user_instances=4096',
    'fs.inotify.max_queued_events=65536',
  ])
})

test('ensureDevInotifyLimits skips non-Linux platforms', () => {
  const result = ensureDevInotifyLimits({
    platform: 'win32',
    env: {},
  })

  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'non-linux')
})

test('ensureDevInotifyLimits attempts a noninteractive sysctl repair', () => {
  const lowProcFiles = {
    ...healthyProcFiles,
    '/proc/sys/fs/inotify/max_user_instances': '128\n',
  }
  const calls = []
  const result = ensureDevInotifyLimits({
    platform: 'linux',
    env: {},
    readFileSync: createProcReader(lowProcFiles),
    getuid: () => 1000,
    spawnSync: (command, args) => {
      calls.push({ command, args })
      return { status: 0, stdout: '', stderr: '' }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.fixed, true)
  assert.deepEqual(calls, [{
    command: 'sudo',
    args: ['-n', 'sysctl', '-w', 'fs.inotify.max_user_instances=4096'],
  }])
})

test('ensureDevInotifyLimits returns manual WSL fix commands when sudo cannot run', () => {
  const lowProcFiles = {
    ...healthyProcFiles,
    '/proc/sys/fs/inotify/max_user_instances': '128\n',
  }
  const result = ensureDevInotifyLimits({
    platform: 'linux',
    env: {},
    readFileSync: createProcReader(lowProcFiles),
    getuid: () => 1000,
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'sudo: a password is required\n' }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.isWsl, true)
  assert.match(result.message, /WSL2\/Linux file-watch limits are too low/)
  assert.match(result.message, /fs\.inotify\.max_user_instances: 128 < 4096/)
  assert.ok(result.manualCommands.some((command) => command.includes('sudo sysctl -w')))
  assert.ok(result.manualCommands.some((command) => command.includes('/etc/sysctl.d/99-open-mercato-inotify.conf')))
})

test('buildPersistentSysctlConfig writes all required inotify keys', () => {
  assert.equal(buildPersistentSysctlConfig(), [
    '# Open Mercato dev server file-watch limits',
    'fs.inotify.max_user_watches=4194304',
    'fs.inotify.max_user_instances=4096',
    'fs.inotify.max_queued_events=65536',
    '',
  ].join('\n'))
})

test('mergeVsCodeWatcherExcludes preserves existing settings and adds watcher exclusions', () => {
  const result = mergeVsCodeWatcherExcludes({
    'editor.tabSize': 2,
    'files.watcherExclude': {
      '**/.git/**': true,
      '**/custom/**': true,
    },
  })

  assert.equal(result.changed, true)
  assert.equal(result.settings['editor.tabSize'], 2)
  assert.equal(result.settings['files.watcherExclude']['**/custom/**'], true)
  assert.equal(result.settings['files.watcherExclude']['.claude/**'], true)
  assert.equal(result.settings['files.watcherExclude']['apps/mercato/.mercato/**'], true)
  assert.equal(result.settings['search.exclude']['.ai/tmp/**'], true)
})

test('mergeVsCodeWatcherExcludes is unchanged when recommended exclusions already exist', () => {
  const first = mergeVsCodeWatcherExcludes({})
  const second = mergeVsCodeWatcherExcludes(first.settings)

  assert.equal(second.changed, false)
  assert.deepEqual(second.settings, first.settings)
})
