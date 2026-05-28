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
  } catch (err) {
    console.error(`  [harness] ${moduleId} ${command} threw:`, err instanceof Error ? err.message : err)
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

async function runGate(cwd: string, withLoginCheck: boolean, moduleId: string | null): Promise<StepResult[]> {
  const results: StepResult[] = []
  const total = withLoginCheck ? 5 : 4

  console.log(`  [1/${total}] yarn generate`)
  const generateOk = spawnYarn('generate', cwd)
  results.push({ label: 'yarn generate', ok: generateOk })

  if (!generateOk) {
    const remaining = total - 1
    for (let i = 2; i <= total; i++) {
      results.push({ label: i === 2 ? 'structural cache purge' : i === 3 ? 'ACL sync' : i === 4 ? 'yarn typecheck' : '/login smoke check', ok: false, note: 'skipped — generate failed' })
    }
    return results
  }

  console.log(`  [2/${total}] configs cache structural --all-tenants`)
  const cacheOk = await runModuleCli('configs', 'cache', ['structural', '--all-tenants', '--quiet'])
  results.push({ label: 'structural cache purge', ok: cacheOk, note: cacheOk ? undefined : 'configs module unavailable' })

  console.log(`  [3/${total}] auth sync-role-acls`)
  const aclOk = await runModuleCli('auth', 'sync-role-acls', [])
  results.push({ label: 'ACL sync', ok: aclOk, note: aclOk ? undefined : 'auth module unavailable' })

  console.log(`  [4/${total}] yarn typecheck`)
  const typecheckOk = spawnYarn('typecheck', cwd)
  results.push({
    label: 'yarn typecheck',
    ok: typecheckOk,
    note: typecheckOk
      ? undefined
      : moduleId
        ? `type errors — check ${moduleId}/events.ts, ${moduleId}/acl.ts, and ${moduleId}/api/*/route.ts`
        : 'fix type errors before committing',
  })

  if (withLoginCheck) {
    console.log(`  [5/${total}] /login smoke check`)
    const port = process.env.PORT ?? process.env.APP_PORT ?? '3000'
    let loginOk = false
    try {
      const { default: http } = await import('node:http')
      loginOk = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://localhost:${port}/login`, (res) => resolve((res.statusCode ?? 0) < 500))
        req.on('error', () => resolve(false))
        req.setTimeout(5000, () => { req.destroy(); resolve(false) })
      })
    } catch {
      loginOk = false
    }
    results.push({
      label: `/login smoke check (port ${port})`,
      ok: loginOk,
      note: loginOk ? undefined : 'dev server not running or /login returned 5xx — check events.ts and acl.ts exports',
    })
  }

  return results
}

const verify: ModuleCli = {
  command: 'verify',
  async run(_rest: string[]) {
    console.log('\n🔍 Running post-scaffold validation gate...\n')
    const results = await runGate(process.cwd(), false, null)
    printResults(results)
  },
}

const postScaffold: ModuleCli = {
  command: 'post-scaffold',
  async run(rest: string[]) {
    const moduleIdx = rest.indexOf('--module')
    const moduleId = moduleIdx !== -1 ? (rest[moduleIdx + 1] ?? null) : null

    if (moduleId) {
      console.log(`\n🔍 Post-scaffold validation for module: ${moduleId}\n`)
    } else {
      console.log('\n🔍 Post-scaffold validation gate\n')
    }

    const results = await runGate(process.cwd(), true, moduleId)
    printResults(results)

    if (moduleId) {
      const anyFailed = results.some((r) => !r.ok)
      if (anyFailed) {
        console.log(`\n💡 Common fixes for module "${moduleId}":`)
        console.log(`   acl.ts missing default export → add: export default features`)
        console.log(`   events.ts wrong shape → use: createModuleEvents({ moduleId: '${moduleId}', events: [...] })`)
        console.log(`   route.ts stale factory → use: makeCrudRoute({ metadata, orm, list, create, update, del })`)
      }
    }
  },
}

export default [verify, postScaffold]
