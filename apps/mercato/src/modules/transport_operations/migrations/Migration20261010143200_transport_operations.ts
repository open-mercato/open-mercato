import { Migration } from '@mikro-orm/migrations';

/**
 * Makes the vehicle identity indexes actually unique.
 *
 * The entities declared these with `@Index({ properties, options: { unique: true,
 * where } })`, which under MikroORM v7 emits a **plain** index — the live database
 * had `CREATE INDEX "transport_vehicles_plate_unique_idx" …` with no UNIQUE, so a
 * duplicate plate number was accepted and a real one exists in the data. The
 * entity now declares the index as an `expression`, which is the only form that
 * carries the partial-unique predicate through to SQL.
 *
 * The generator could not see this: the index *name* was already in the snapshot,
 * so the diff reported no change while the semantics differed. The statements are
 * therefore written out here, and the module's snapshot is updated to the
 * expression form in the same change.
 *
 * NOTE: this migration fails if the table already holds duplicates. Run the
 * duplicate report in the PR description and resolve them first.
 */
export class Migration20261010143200_transport_operations extends Migration {

  override name = 'Migration20261010143200';

  override up(): void | Promise<void> {
    this.addSql(`drop index if exists "transport_vehicles_plate_unique_idx";`);
    this.addSql(`create unique index "transport_vehicles_plate_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "plate_number") where deleted_at is null;`);

    this.addSql(`drop index if exists "transport_vehicles_vin_unique_idx";`);
    this.addSql(`create unique index "transport_vehicles_vin_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "vin") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "transport_vehicles_plate_unique_idx";`);
    this.addSql(`create index "transport_vehicles_plate_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "plate_number");`);

    this.addSql(`drop index if exists "transport_vehicles_vin_unique_idx";`);
    this.addSql(`create index "transport_vehicles_vin_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "vin");`);
  }

}
