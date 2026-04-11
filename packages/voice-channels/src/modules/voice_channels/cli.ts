import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { seedDemoData } from './data/seed/demo-seed'

const DEMO_SCRIPT_PATH = path.resolve(
    __dirname,
    'data/demo-scripts/demo-1-acme-steel.json',
)
const CUSTOMER_ID_PLACEHOLDER = 'ACME_CUSTOMER_ID'

function parseArgs(rest: string[]): Record<string, string> {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 1) {
        const part = rest[i]
        if (!part?.startsWith('--')) continue
        const [rawKey, rawValue] = part.slice(2).split('=')
        if (rawValue !== undefined) {
            args[rawKey] = rawValue
        } else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
            args[rawKey] = rest[i + 1]!
            i += 1
        }
    }
    return args
}

const seedDemoCommand: ModuleCli = {
    command: 'seed-demo',
    async run(rest) {
        const args = parseArgs(rest)
        const tenantId = String(args.tenantId ?? args.tenant ?? '')
        const organizationId = String(
            args.organizationId ?? args.org ?? args.orgId ?? '',
        )
        if (!tenantId || !organizationId) {
            console.error(
                'Usage: mercato voice_channels seed-demo --tenant <tenantId> --org <organizationId>',
            )
            process.exitCode = 1
            return
        }

        const container = await createRequestContainer()
        try {
            const em = container.resolve<EntityManager>('em')
            let result!: Awaited<ReturnType<typeof seedDemoData>>
            await em.transactional(async (tem) => {
                result = await seedDemoData(tem, organizationId, tenantId)
            })

            await updateDemoScriptCustomerId(result.customerId)

            console.log('🎙️  Voice Channels demo seeded')
            console.log('   companyId :', result.companyId)
            console.log('   customerId:', result.customerId)
            console.log('   products  :', result.productIds.length)
            console.log('   deals     :', result.dealIds.length)
            console.log('   demo JSON :', DEMO_SCRIPT_PATH)
        } finally {
            const disposable = container as unknown as { dispose?: () => Promise<void> }
            if (typeof disposable.dispose === 'function') {
                await disposable.dispose()
            }
        }
    },
}

async function updateDemoScriptCustomerId(customerId: string): Promise<void> {
    const raw = await fs.readFile(DEMO_SCRIPT_PATH, 'utf8')
    const script = JSON.parse(raw) as Record<string, unknown>
    const current = script.customerId
    if (current === customerId) return
    if (typeof current !== 'string') {
        throw new Error(
            `Unexpected customerId type in ${DEMO_SCRIPT_PATH}: ${typeof current}`,
        )
    }
    if (current !== CUSTOMER_ID_PLACEHOLDER && !isUuid(current)) {
        throw new Error(
            `Refusing to overwrite non-UUID customerId "${current}" in ${DEMO_SCRIPT_PATH}`,
        )
    }
    script.customerId = customerId
    await fs.writeFile(
        DEMO_SCRIPT_PATH,
        `${JSON.stringify(script, null, 2)}\n`,
        'utf8',
    )
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
    )
}

const cli: ModuleCli[] = [seedDemoCommand]
export default cli