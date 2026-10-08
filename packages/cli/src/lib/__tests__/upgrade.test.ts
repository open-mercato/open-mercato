import {
  SEED_DEFAULTS_HAZARDS,
  UpgradeRefusal,
  assertDeploymentInitialized,
  assertTenantExists,
  parseUpgradeTenantScope,
  printSeedDefaultsWarning,
  printUpgradeFollowUps,
  runUpgradeSteps,
  type UpgradeQuery,
} from '../upgrade'
import fs from 'node:fs'
import path from 'node:path'

type Invocation = { module: string; command: string; args: string[]; optional?: boolean }

function createHarness(
  overrides: {
    commandResult?: (invocation: Invocation) => Promise<boolean>
    seedDefaults?: () => Promise<void>
  } = {},
) {
  const invocations: Invocation[] = []
  const order: string[] = []
  const logs: string[] = []
  const warnings: string[] = []

  const deps = {
    migrate: async () => {
      order.push('migrate')
    },
    runModuleCommand: async (
      moduleName: string,
      commandName: string,
      args: string[],
      options?: { optional?: boolean },
    ) => {
      const invocation = { module: moduleName, command: commandName, args, optional: options?.optional }
      invocations.push(invocation)
      order.push(`${moduleName}:${commandName}`)
      return overrides.commandResult ? overrides.commandResult(invocation) : true
    },
    seedDefaults: overrides.seedDefaults
      ? async () => {
          order.push('seed:defaults')
          await overrides.seedDefaults!()
        }
      : undefined,
    log: (message: string) => logs.push(message),
    warn: (message: string) => warnings.push(message),
  }

  return { deps, invocations, order, logs, warnings }
}

describe('runUpgradeSteps', () => {
  const originalExitCode = process.exitCode
  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('runs the four reconcile steps in the documented order', async () => {
    const harness = createHarness()
    await runUpgradeSteps(harness.deps)

    expect(harness.order).toEqual([
      'migrate',
      'entities:install',
      'auth:sync-role-acls',
      'feature_toggles:seed-defaults',
    ])
  })

  // Step 1 must not go through runModuleCommand: `buildAllModules()` does not include the built-in
  // `db` module, so dispatching migrations that way fails with missing-module — and `upgrade`
  // already holds the lock, so it needs the unlocked primitive regardless.
  it('applies migrations through its own runner, not as a module command', async () => {
    const harness = createHarness()
    await runUpgradeSteps(harness.deps)

    expect(harness.order[0]).toBe('migrate')
    expect(harness.invocations.some((inv) => inv.module === 'db')).toBe(false)
  })

  // Risk 1's control. Someone re-adding a destructive step without revisiting the audit in
  // .ai/specs/2026-07-27-mercato-upgrade-reconcile-command.md fails here. Do not delete this test.
  it('never invokes the destructive-on-re-run commands on the default path', async () => {
    const harness = createHarness()
    await runUpgradeSteps(harness.deps)

    const touched = harness.invocations.map((inv) => `${inv.module}:${inv.command}`)
    expect(touched).not.toContain('configs:restore-defaults')
    expect(touched.some((name) => name.includes('reindex'))).toBe(false)
    expect(touched.some((name) => name.includes('seed-examples'))).toBe(false)
    expect(harness.order).not.toContain('seed:defaults')
  })

  it('does not run seed:defaults unless the flag is passed, even when a runner is available', async () => {
    const harness = createHarness({ seedDefaults: async () => undefined })
    await runUpgradeSteps(harness.deps)
    expect(harness.order).not.toContain('seed:defaults')
  })

  it('runs seed:defaults as a fifth step when explicitly opted in', async () => {
    const harness = createHarness({ seedDefaults: async () => undefined })
    await runUpgradeSteps(harness.deps, { withSeedDefaults: true })
    expect(harness.order[harness.order.length - 1]).toBe('seed:defaults')
  })

  it('refuses the opt-in when no seed runner was wired up', async () => {
    const harness = createHarness()
    await expect(runUpgradeSteps(harness.deps, { withSeedDefaults: true })).rejects.toThrow(
      /no seed runner/,
    )
  })

  // `auth sync-role-acls` silently ignores `--tenant=<id>`, reading it as a flag literally named
  // `tenant=<id>` — so a scoped run passed that way would widen into an all-tenant run.
  it('passes tenant scope explicitly, in the spelling every composed command parses', async () => {
    const harness = createHarness()
    await runUpgradeSteps(harness.deps, { tenantId: 'tenant-1' })

    const entities = harness.invocations.find((inv) => inv.command === 'install')
    const acls = harness.invocations.find((inv) => inv.command === 'sync-role-acls')
    expect(entities?.args).toEqual(['--tenant', 'tenant-1'])
    expect(acls?.args).toEqual(['--tenant', 'tenant-1'])
  })

  it('passes no scope flags when unscoped', async () => {
    const harness = createHarness()
    await runUpgradeSteps(harness.deps)
    expect(harness.invocations.find((inv) => inv.command === 'install')?.args).toEqual([])
  })

  it('never passes --force to entities install, which would defeat its checksum cache', async () => {
    const harness = createHarness()
    await runUpgradeSteps(harness.deps)
    const entities = harness.invocations.find((inv) => inv.command === 'install')
    expect(entities?.args).not.toContain('--force')
  })

  it('tolerates feature_toggles being absent from the deployment', async () => {
    const harness = createHarness({
      commandResult: async (invocation) => invocation.module !== 'feature_toggles',
    })
    const outcomes = await runUpgradeSteps(harness.deps)

    expect(harness.invocations.find((inv) => inv.module === 'feature_toggles')?.optional).toBe(true)
    expect(outcomes.find((o) => o.label.startsWith('feature_toggles'))?.status).toBe('skipped')
  })

  it('tolerates a missing feature_toggles defaults file rather than failing the deploy', async () => {
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' })
    const harness = createHarness({
      commandResult: async (invocation) => {
        if (invocation.module === 'feature_toggles') throw enoent
        return true
      },
    })

    const outcomes = await runUpgradeSteps(harness.deps)
    expect(outcomes.find((o) => o.label.startsWith('feature_toggles'))?.status).toBe('tolerated')
    expect(harness.warnings.join('\n')).toMatch(/defaults file is missing/)
  })

  it('still fails when feature_toggles throws for any other reason', async () => {
    const harness = createHarness({
      commandResult: async (invocation) => {
        if (invocation.module === 'feature_toggles') throw new Error('toggle table is gone')
        return true
      },
    })
    await expect(runUpgradeSteps(harness.deps)).rejects.toThrow('toggle table is gone')
  })

  // Several composed commands report a refusal by printing and returning. Without this, `upgrade`
  // would print its success line having reconciled nothing.
  it('fails when a step signals failure through a non-zero exit code instead of throwing', async () => {
    const harness = createHarness({
      commandResult: async (invocation) => {
        if (invocation.command === 'sync-role-acls') {
          process.exitCode = 1
          return true
        }
        return true
      },
    })

    await expect(runUpgradeSteps(harness.deps)).rejects.toThrow(/auth sync-role-acls.*exit code 1/)
  })

  it('leaves the ambient exit code untouched on success', async () => {
    process.exitCode = undefined
    const harness = createHarness()
    await runUpgradeSteps(harness.deps)
    expect(process.exitCode).toBeUndefined()
  })

  it('reports a duration per step', async () => {
    const harness = createHarness()
    const outcomes = await runUpgradeSteps(harness.deps)
    expect(outcomes).toHaveLength(4)
    for (const outcome of outcomes) {
      expect(typeof outcome.durationMs).toBe('number')
    }
    expect(harness.logs.join('\n')).toMatch(/entities install —/)
  })
})

describe('preflight guards', () => {
  const queryStub = (rows: Record<string, Array<Record<string, unknown>>>): UpgradeQuery => {
    return async (sql) => {
      const key = Object.keys(rows).find((fragment) => sql.includes(fragment))
      return { rows: key ? rows[key]! : [] }
    }
  }

  it('refuses a database that was never initialized', async () => {
    await expect(
      assertDeploymentInitialized(queryStub({ to_regclass: [{ regclass: null }] })),
    ).rejects.toThrow(UpgradeRefusal)
  })

  it('refuses a database whose users table is empty', async () => {
    await expect(
      assertDeploymentInitialized(
        queryStub({ to_regclass: [{ regclass: 'users' }], 'COUNT(*)': [{ count: '0' }] }),
      ),
    ).rejects.toThrow(/mercato init/)
  })

  it('accepts an initialized database', async () => {
    await expect(
      assertDeploymentInitialized(
        queryStub({ to_regclass: [{ regclass: 'users' }], 'COUNT(*)': [{ count: '3' }] }),
      ),
    ).resolves.toBeUndefined()
  })

  it('refuses an unknown or soft-deleted tenant before any step runs', async () => {
    await expect(assertTenantExists(queryStub({}), 'nope')).rejects.toThrow(UpgradeRefusal)
  })

  it('accepts a live tenant', async () => {
    await expect(
      assertTenantExists(queryStub({ 'FROM tenants': [{ id: 'tenant-1' }] }), 'tenant-1'),
    ).resolves.toBeUndefined()
  })

  it('excludes soft-deleted tenants in the lookup itself', async () => {
    const seen: string[] = []
    const query: UpgradeQuery = async (sql) => {
      seen.push(sql)
      return { rows: [{ id: 'tenant-1' }] }
    }
    await assertTenantExists(query, 'tenant-1')
    expect(seen[0]).toContain('deleted_at IS NULL')
  })
})

describe('operator guidance', () => {
  it('names the follow-ups upgrade deliberately does not run', () => {
    const lines: string[] = []
    printUpgradeFollowUps((message) => lines.push(message))
    const output = lines.join('\n')

    expect(output).toContain('mercato seed:defaults')
    expect(output).toContain('mercato reindex')
    expect(output).toContain('configs restore-defaults')
    expect(output).toContain('--with-seed-defaults')
  })

  it('stops advertising the opt-in flag once it has already run', () => {
    const lines: string[] = []
    printUpgradeFollowUps((message) => lines.push(message), { seedDefaultsAlreadyRan: true })
    const output = lines.join('\n')

    expect(output).not.toContain('--with-seed-defaults')
    expect(output).toContain('UPGRADE_NOTES.md')
  })

  it('points the operator at UPGRADE_NOTES.md and its auto-upgrade skill', () => {
    const lines: string[] = []
    printUpgradeFollowUps((message) => lines.push(message))
    const output = lines.join('\n')

    expect(output).toContain('UPGRADE_NOTES.md')
    expect(output).toMatch(/om-auto-upgrade-<from>-<to>/)
    expect(output).toMatch(/coding agent/)
  })

  it('warns with the measured hazards before an opt-in seed run', () => {
    const lines: string[] = []
    printSeedDefaultsWarning((message) => lines.push(message))
    const output = lines.join('\n')

    expect(output).toMatch(/does not treat as idempotent/i)
    expect(output).toMatch(/MUST NOT be wired into a deploy script/)
    for (const hazard of SEED_DEFAULTS_HAZARDS) {
      expect(output).toContain(hazard)
    }
  })
})

describe('tenant scope parsing', () => {
  it('reads both spellings and the tenantId alias', () => {
    expect(parseUpgradeTenantScope(['--tenant', 'tenant-1'])).toBe('tenant-1')
    expect(parseUpgradeTenantScope(['--tenant=tenant-1'])).toBe('tenant-1')
    expect(parseUpgradeTenantScope(['--tenantId', 'tenant-1'])).toBe('tenant-1')
    expect(parseUpgradeTenantScope(['--tenantId=tenant-1'])).toBe('tenant-1')
    expect(parseUpgradeTenantScope(['--lock-timeout=30', '--tenant', 'tenant-1'])).toBe('tenant-1')
  })

  it('reads an absent flag as every tenant', () => {
    expect(parseUpgradeTenantScope([])).toBeNull()
    expect(parseUpgradeTenantScope(['--no-lock', '--with-seed-defaults'])).toBeNull()
  })

  it('trims a padded value instead of scoping to whitespace', () => {
    expect(parseUpgradeTenantScope(['--tenant= tenant-1 '])).toBe('tenant-1')
  })

  // Reading a present-but-valueless scope flag as absent is the failure this guards: both
  // tenant-aware steps would receive an empty scope and reconcile every tenant, granting ACLs and
  // reinstalling definitions outside the one the operator named.
  it.each([
    ['a bare flag at the end of the argv', ['--tenant']],
    ['a bare flag followed by another flag', ['--tenant', '--no-lock']],
    ['an empty assignment from a blank variable expansion', ['--tenant=']],
    ['a whitespace-only assignment', ['--tenant=   ']],
    ['a bare alias', ['--tenantId']],
    ['an empty alias assignment', ['--tenantId=']],
  ])('refuses %s', (_label, args) => {
    expect(() => parseUpgradeTenantScope(args)).toThrow(UpgradeRefusal)
    expect(() => parseUpgradeTenantScope(args)).toThrow(/without a tenant id/)
  })

  it('refuses a valueless flag rather than falling through to the alias', () => {
    expect(() => parseUpgradeTenantScope(['--tenant=', '--tenantId=tenant-1'])).toThrow(
      UpgradeRefusal,
    )
  })

  // The refusal only protects the operator if the CLI entry point parses through this function.
  // `mercato.ts` statically imports the whole CLI graph, so the delegation is asserted against the
  // source rather than by booting the command.
  it('is what the `mercato upgrade` entry point parses with', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'mercato.ts'), 'utf8')
    expect(source).toContain('parseUpgradeTenantScope(upgradeArgs)')
    expect(source).not.toMatch(/readUpgradeFlag/)
  })

  it('refuses before the lock is taken or anything migrates', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'mercato.ts'), 'utf8')
    const parsedAt = source.indexOf('parseUpgradeTenantScope(upgradeArgs)')
    const lockedAt = source.indexOf('await withUpgradeLock(')
    expect(parsedAt).toBeGreaterThan(-1)
    expect(lockedAt).toBeGreaterThan(parsedAt)
  })
})
