import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { referenceScopeSchema } from './data/validators'
import { seedReferenceExamples } from './setup'

function parseScope(argumentsList: string[]): { tenantId: string; organizationId: string } {
  const values = new Map<string, string>()
  for (let index = 0; index < argumentsList.length; index += 1) {
    const token = argumentsList[index]
    if (!token?.startsWith('--')) continue
    const [key, inlineValue] = token.slice(2).split('=', 2)
    if (inlineValue) {
      values.set(key, inlineValue)
      continue
    }
    const nextValue = argumentsList[index + 1]
    if (nextValue && !nextValue.startsWith('--')) {
      values.set(key, nextValue)
      index += 1
    }
  }
  return referenceScopeSchema.parse({
    tenantId: values.get('tenant') ?? values.get('tenantId'),
    organizationId: values.get('org') ?? values.get('organizationId'),
  })
}

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(argumentsList) {
    const scope = parseScope(argumentsList)
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const created = await em.transactional((transactionalEntityManager) => (
        seedReferenceExamples(transactionalEntityManager, scope)
      ))
      process.stdout.write(`${JSON.stringify({ created, scope })}\n`)
    } finally {
      const disposableContainer = container as unknown as { dispose?: () => Promise<void> }
      await disposableContainer.dispose?.()
    }
  },
}

export default [seedExamplesCommand]
