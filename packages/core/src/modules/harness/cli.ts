import { execSync } from 'node:child_process'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { getCliModules } from '@open-mercato/shared/modules/registry'

type StepResult = { label: string; ok: boolean; note?: string }

function spawnYarn(args: string, cwd: string): boolean {
  try {
    execSync(`yarn ${args}`, { stdio: 'inherit', cwd })
    return true
  } catch {
    return false
  }
}

async function runModuleCli(moduleId: string, command: string, rest: string[]): Promise<boolean> {
  const modules = getCliModules()
  const mod = modules.find((m) => m.id === moduleId)
  if (!mod) return false
  const handler = mod.cli?.find((c) => c.command === command)
  if (!handler) return false
  try {
    await handler.run(rest)
    return true
  } catch {
    return false
  }
}

function printResults(results: StepResult[]): void {
  console.log('')
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌'
    const note = r.note ? ` — ${r.note}` : ''
    console.log(`  ${icon} ${r.label}${note}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (failed.length === 0) {
    console.log('✅ All validation steps passed.')
  } else {
    console.log(`❌ ${failed.length} step(s) failed: ${failed.map((r) => r.label).join(', ')}`)
    process.exitCode = 1
  }
}

const verify: ModuleCli = {
  command: 'verify',
  async run() {
    const cwd = process.cwd()
    const results: StepResult[] = []

    console.log('\n🔍 Running post-scaffold validation gate...\n')

    console.log('  [1/4] yarn generate')
    const generateOk = spawnYarn('generate', cwd)
    results.push({ label: 'yarn generate', ok: generateOk })

    console.log('  [2/4] configs cache structural --all-tenants')
    const cacheOk = await runModuleCli('configs', 'cache', ['structural', '--all-tenants', '--quiet'])
    results.push({ label: 'structural cache purge', ok: cacheOk, note: cacheOk ? undefined : 'configs module unavailable' })

    console.log('  [3/4] auth sync-role-acls')
    const aclOk = await runModuleCli('auth', 'sync-role-acls', [])
    results.push({ label: 'ACL sync', ok: aclOk, note: aclOk ? undefined : 'auth module unavailable' })

    console.log('  [4/4] yarn typecheck')
    const typecheckOk = spawnYarn('typecheck', cwd)
    results.push({ label: 'yarn typecheck', ok: typecheckOk, note: typecheckOk ? undefined : 'fix type errors before committing' })

    printResults(results)
  },
}

const postScaffold: ModuleCli = {
  command: 'post-scaffold',
  async run(rest) {
    const moduleArg = rest.find((_, i) => rest[i - 1] === '--module') ?? rest[rest.indexOf('--module') + 1]
    const moduleId = moduleArg ?? null

    const cwd = process.cwd()
    const results: StepResult[] = []

    if (moduleId) {
      console.log(`\n🔍 Post-scaffold validation for module: ${moduleId}\n`)
    } else {
      console.log('\n🔍 Post-scaffold validation gate\n')
    }

    console.log('  [1/5] yarn generate')
    const generateOk = spawnYarn('generate', cwd)
    results.push({ label: 'yarn generate', ok: generateOk })

    console.log('  [2/5] configs cache structural --all-tenants')
    const cacheOk = await runModuleCli('configs', 'cache', ['structural', '--all-tenants', '--quiet'])
    results.push({ label: 'structural cache purge', ok: cacheOk, note: cacheOk ? undefined : 'configs module unavailable' })

    console.log('  [3/5] auth sync-role-acls')
    const aclOk = await runModuleCli('auth', 'sync-role-acls', [])
    results.push({ label: 'ACL sync', ok: aclOk, note: aclOk ? undefined : 'auth module unavailable' })

    console.log('  [4/5] yarn typecheck')
    const typecheckOk = spawnYarn('typecheck', cwd)
    results.push({
      label: 'yarn typecheck',
      ok: typecheckOk,
      note: typecheckOk ? undefined : 'type errors in generated files — check events.ts, acl.ts, and route.ts',
    })

    console.log('  [5/5] /login smoke check')
    let loginOk = false
    try {
      const { default: http } = await import('node:http')
      loginOk = await new Promise<boolean>((resolve) => {
        const req = http.get('http://localhost:3000/login', (res) => resolve((res.statusCode ?? 0) < 500))
        req.on('error', () => resolve(false))
        req.setTimeout(5000, () => { req.destroy(); resolve(false) })
      })
    } catch {
      loginOk = false
    }
    results.push({
      label: '/login smoke check',
      ok: loginOk,
      note: loginOk ? undefined : 'dev server not running or /login returned 5xx — check events.ts and acl.ts exports',
    })

    printResults(results)

    if (moduleId) {
      console.log(`\n💡 Tip: If type errors mention missing "default" export from acl.ts, add:`)
      console.log(`   export default features`)
      console.log(`\n   If events.ts crashes at runtime, ensure createModuleEvents uses the array shape:`)
      console.log(`   createModuleEvents({ moduleId: '${moduleId}', events: [...] })`)
    }
  },
}

export default [verify, postScaffold]
