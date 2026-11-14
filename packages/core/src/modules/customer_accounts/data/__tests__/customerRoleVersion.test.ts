import { MetadataStorage } from '@mikro-orm/core'
import { CustomerRole } from '../entities'

/**
 * #8846 — before this fix `CustomerRole.updated_at` declared only `onUpdate`,
 * so a freshly created role persisted `updated_at = NULL`. The command-level
 * optimistic-lock guard (`enforceCommandOptimisticLockWithGuards`) treats a
 * null `current` version as unlockable and no-ops
 * (`packages/shared/src/lib/crud/optimistic-lock-command.ts`), so a new role's
 * very first concurrent edit always won the race silently — a lost update.
 *
 * This pins the fix: `updated_at` MUST also declare `onCreate`, and that hook
 * MUST actually produce a `Date` when MikroORM runs it during insert.
 */
describe('CustomerRole.updatedAt is initialized on create (#8846)', () => {
  // Importing the module runs its @Entity decorators, which populate MetadataStorage.
  void CustomerRole

  function updatedAtProperty() {
    const meta = Object.values(MetadataStorage.getMetadata()).find(
      (candidate) => candidate.className === 'CustomerRole',
    )
    return meta?.properties.updatedAt
  }

  it('declares an onCreate hook that stamps a Date', () => {
    const prop = updatedAtProperty()
    expect(typeof prop?.onCreate).toBe('function')
    const stamped = prop!.onCreate!({} as CustomerRole)
    expect(stamped).toBeInstanceOf(Date)
  })

  it('still declares an onUpdate hook (regression guard against losing the bump-on-save behavior)', () => {
    const prop = updatedAtProperty()
    expect(typeof prop?.onUpdate).toBe('function')
    const bumped = prop!.onUpdate!({} as CustomerRole)
    expect(bumped).toBeInstanceOf(Date)
  })

  it('remains nullable at the DB level (existing pre-fix rows may still be null until backfilled)', () => {
    const prop = updatedAtProperty()
    expect(prop?.nullable).toBe(true)
  })
})
