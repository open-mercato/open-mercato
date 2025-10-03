import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'

export interface DataEngine {
  setCustomFields(opts: {
    entityId: string
    recordId: string
    organizationId?: string | null
    tenantId?: string | null
    values: Record<string, string | number | boolean | null | undefined | Array<string | number | boolean | null | undefined>>
    notify?: boolean // default true -> emit '<module>.<entity>.updated'
  }): Promise<void>
}

export class DefaultDataEngine implements DataEngine {
  constructor(private em: EntityManager, private container: AwilixContainer) {}

  async setCustomFields(opts: Parameters<DataEngine['setCustomFields']>[0]): Promise<void> {
    const { entityId, recordId, organizationId = null, tenantId = null, values } = opts
    await setRecordCustomFields(this.em, {
      entityId,
      recordId,
      organizationId,
      tenantId,
      values,
    })
    if (opts.notify !== false) {
      try {
        const bus = this.container.resolve<any>('eventBus')
        const [mod, ent] = (entityId || '').split(':')
        if (mod && ent) {
          await bus.emitEvent(`${mod}.${ent}.updated`, { id: recordId, organizationId, tenantId }, { persistent: true })
        }
      } catch {
        // non-blocking
      }
    }
  }
}
