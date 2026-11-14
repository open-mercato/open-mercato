import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

function initializeHarness(runtimePath, functionName, { args = [], setupMode = false, greenfield = false, existingUsers = true } = {}) {
  const source = readFileSync(new URL(runtimePath, import.meta.url), 'utf8')
  const declaration = source.match(/^const reinstall = .+$/m)?.[0]
  assert.ok(declaration)
  const start = source.indexOf(`async function ${functionName}()`)
  const end = source.indexOf('\nasync function ', start + 1)
  assert.ok(start >= 0 && end > start)
  const commands = []
  const launches = []
  const data = { users: existingUsers ? ['existing-user'] : [] }
  const runCommand = async (commandArgs) => {
    const command = Array.from(commandArgs)
    commands.push(command)
    if (command[0] !== 'initialize') return
    if (command.includes('--reinstall')) data.users = []
    if (data.users.length > 0 && !command.includes('--skip-if-initialized')) throw new Error('Initialization aborted: existing users')
    if (data.users.length === 0) data.users.push('new-user')
  }
  const context = {
    args, setupMode, greenfield,
    INIT_DEV_AUTOSTART_ENV: {},
    standaloneLocalRegistryRefresh: false,
    standaloneStageTotal: 5,
    purgeAppBuildCaches() {},
    purgeGreenfieldCaches() { return true },
    ensureStandaloneEnvFile() {},
    applyDatabaseNameOverrideIfRequested: async () => {},
    runStage: async (_title, commandArgs) => runCommand(commandArgs),
    runPassthroughStage: async (_title, commandArgs) => runCommand(commandArgs),
    runRawYarnCommand: runCommand,
    startPackageWatch: () => launches.push('watch'),
    launchMonorepoAppDev: () => launches.push('monorepo-app'),
    launchStandaloneDev: () => launches.push('standalone-app'),
  }
  return {
    run: () => runInNewContext(`${declaration}\n${source.slice(start, end)}\n${functionName}()`, context),
    commands, launches, data,
  }
}

for (const runtimePath of ['../dev.mjs', '../../packages/create-app/template/scripts/dev.mjs']) {
  for (const functionName of ['runGreenfieldDev', 'runClassicGreenfieldDev']) {
    test(`${runtimePath} ${functionName} retains the established automatic reinstall default`, async () => {
      const fixture = initializeHarness(runtimePath, functionName, { args: ['--greenfield'], greenfield: true })
      await fixture.run()
      assert.deepEqual(fixture.commands.find((command) => command[0] === 'initialize'), ['initialize', '--', '--reinstall'])
      assert.deepEqual(fixture.data.users, ['new-user'])
      assert.deepEqual(fixture.launches, ['watch', 'monorepo-app'])
    })

    test(`${runtimePath} ${functionName} forwards explicitly requested reinstall`, async () => {
      const fixture = initializeHarness(runtimePath, functionName, { args: ['--greenfield', '--reinstall'], greenfield: true })
      await fixture.run()
      assert.deepEqual(fixture.commands.find((command) => command[0] === 'initialize'), ['initialize', '--', '--reinstall'])
      assert.deepEqual(fixture.data.users, ['new-user'])
      assert.deepEqual(fixture.launches, ['watch', 'monorepo-app'])
    })

    test(`${runtimePath} ${functionName} initializes an empty database through the same reinstall path`, async () => {
      const fixture = initializeHarness(runtimePath, functionName, { args: ['--greenfield'], greenfield: true, existingUsers: false })
      await fixture.run()
      assert.deepEqual(fixture.commands.find((command) => command[0] === 'initialize'), ['initialize', '--', '--reinstall'])
      assert.deepEqual(fixture.data.users, ['new-user'])
      assert.deepEqual(fixture.launches, ['watch', 'monorepo-app'])
    })
  }

  for (const functionName of ['runStandaloneSetup', 'runClassicStandaloneSetup']) {
    test(`${runtimePath} ${functionName} keeps initialized data on an ordinary setup rerun`, async () => {
      const fixture = initializeHarness(runtimePath, functionName, { args: ['--setup'], setupMode: true })
      await fixture.run()
      assert.deepEqual(fixture.commands.find((command) => command[0] === 'initialize'), ['initialize', '--skip-if-initialized'])
      assert.deepEqual(fixture.data.users, ['existing-user'])
      assert.deepEqual(fixture.launches, ['standalone-app'])
    })

    test(`${runtimePath} ${functionName} retains explicitly requested setup reinstall`, async () => {
      const fixture = initializeHarness(runtimePath, functionName, { args: ['--setup', '--reinstall'], setupMode: true })
      await fixture.run()
      assert.deepEqual(fixture.commands.find((command) => command[0] === 'initialize'), ['initialize', '--reinstall'])
      assert.deepEqual(fixture.data.users, ['new-user'])
      assert.deepEqual(fixture.launches, ['standalone-app'])
    })
  }
}
