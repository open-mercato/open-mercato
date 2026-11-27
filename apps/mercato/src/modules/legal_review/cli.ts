import type { EntityManager } from '@mikro-orm/postgresql'
import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { seedLegalReviewDemoData } from './lib/demoSeeds'

const SEED_DEMO_USAGE = 'Usage: mercato legal_review seed-demo --tenant <tenantId> --org <organizationId>'

const seedDemoCommand: ModuleCli = {
  command: 'seed-demo',
  async run(rest) {
    const args = parseModuleCliOptions(rest, { flagValue: undefined })
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error(SEED_DEMO_USAGE)
      process.exitCode = 2
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const result = await em.transactional((tem) =>
        seedLegalReviewDemoData(tem as EntityManager, { tenantId, organizationId }),
      )
      if (!result.seeded) {
        console.log('NDA review demo data already exists in this organization; nothing to do.')
        return
      }
      console.log(
        `NDA review demo data seeded: ${Object.keys(result.documentIds).length} documents, playbook ${result.playbookId}`,
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
    }
  },
}

const legalReviewCli = [seedDemoCommand]

export default legalReviewCli
