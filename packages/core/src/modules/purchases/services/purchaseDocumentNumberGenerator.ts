import type { EntityManager } from '@mikro-orm/postgresql'
import { PurchaseDocumentSequence, type PurchaseDocumentKind } from '../data/entities'

type Scope = {
  organizationId: string
  tenantId: string
}

export class PurchaseDocumentNumberGenerator {
  constructor(private readonly em: EntityManager) {}

  async generateNumber(kind: PurchaseDocumentKind, scope: Scope): Promise<string> {
    const year = new Date().getFullYear()
    const prefix = kind === 'rfq' ? 'RFQ' : kind === 'po' ? 'PO' : kind === 'pz' ? 'PZ' : 'BILL'

    let sequenceRecord = await this.em.findOne(PurchaseDocumentSequence, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      documentKind: kind,
      deletedAt: null,
    })

    if (!sequenceRecord) {
      sequenceRecord = this.em.create(PurchaseDocumentSequence, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        documentKind: kind,
        currentValue: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await this.em.persist(sequenceRecord).flush()
      return `${prefix}/${year}/0001`
    }

    sequenceRecord.currentValue += 1
    sequenceRecord.updatedAt = new Date()
    await this.em.flush()

    const padded = String(sequenceRecord.currentValue).padStart(4, '0')
    return `${prefix}/${year}/${padded}`
  }
}
