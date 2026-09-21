import { BigIntType, MetadataStorage } from '@mikro-orm/core'
import { AttachmentQuotaReservation } from '../entities'

/**
 * `AttachmentQuotaReservation.reservedBytes` / `actualBytes` are declared as TypeScript
 * `number`, but the underlying columns are `bigint`. MikroORM's `BigIntType` defaults to
 * hydrating as a native JS `bigint`, which then silently fails any `typeof value ===
 * 'number'` guard downstream. Each property MUST be configured with the `BigIntType('number')`
 * numeric mode so hydration matches its declared type. See #6237.
 */
describe('attachments bigint-backed number fields', () => {
  // Importing the module runs its @Entity decorators, which populate MetadataStorage.
  void AttachmentQuotaReservation

  function bigIntModeOf(className: string, propertyName: string): string | undefined {
    const meta = Object.values(MetadataStorage.getMetadata()).find(
      (candidate) => candidate.className === className,
    )
    const type = meta?.properties[propertyName]?.type
    expect(type).toBeInstanceOf(BigIntType)
    return (type as InstanceType<typeof BigIntType>).mode
  }

  it('hydrates AttachmentQuotaReservation.reservedBytes as a safe-integer number, not a bigint', () => {
    expect(bigIntModeOf('AttachmentQuotaReservation', 'reservedBytes')).toBe('number')
  })

  it('hydrates AttachmentQuotaReservation.actualBytes as a safe-integer number, not a bigint', () => {
    expect(bigIntModeOf('AttachmentQuotaReservation', 'actualBytes')).toBe('number')
  })
})
