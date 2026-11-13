import { z } from 'zod'
import type { ModuleCli } from '../../modules/registry'
import { validateDeclaredDatabaseBinding } from './declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from './runtime'

function argumentValue(argv: readonly string[], names: readonly string[]): string | undefined {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const [name, ...parts] = argument.split('=')
    if (!names.includes(name)) continue
    const value = parts.length ? parts.join('=') : argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error('[internal] Database CLI identity argument requires a value')
    values.push(z.string().uuid().parse(value).toLowerCase())
  }
  if (new Set(values).size > 1) throw new Error('[internal] Conflicting database CLI identities')
  return values[0]
}

export async function runDatabaseCliCommand(command: ModuleCli, argv: string[], operation: string): Promise<void> {
  if (!isDatabaseRuntimeEnabled()) return command.run(argv)
  const tenantId = argumentValue(argv, ['--tenant', '--tenantId', '--tenant_id'])
  const organizationId = argumentValue(argv, ['--org', '--organization', '--organizationId', '--organization_id'])
  if (tenantId && command.databaseAccess !== 'maintenance') {
    const context = { kind: 'tenant', tenantId, source: 'cli', operation } as const
    const valid = await runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId, source: 'identity', operation }, () => validateDeclaredDatabaseBinding({ context, ...(organizationId ? { organization: { id: organizationId } } : {}) }, { requireValidator: true }))
    if (!valid) throw new Error('[internal] Database CLI tenant binding is unavailable')
    return runWithFreshDatabaseExecutionContext(context, () => command.run(argv))
  }
  if (command.databaseAccess) {
    return runWithFreshDatabaseExecutionContext({ kind: 'maintenance', tenantId: null, source: 'cli', operation }, () => command.run(argv))
  }
  return runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: null, source: 'identity', operation }, () => command.run(argv))
}
