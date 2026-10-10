import { Migration } from '@mikro-orm/migrations';

export class Migration20261010142624_fleet_management extends Migration {

  override name = 'Migration20261010142624';

  override up(): void | Promise<void> {
    this.addSql(`create unique index "fleet_vehicles_sequence_unique_idx" on "fleet_vehicles" ("organization_id", "tenant_id", "sequence_number") where deleted_at is null and sequence_number is not null;`);

    // Hand-added: the plate index was declared with `options: { unique: true }`,
    // which emits a plain index, so the live database has a NON-unique
    // `fleet_vehicles_plate_unique_idx` and duplicate plates were accepted. The
    // generator cannot see the change — the index name was already in the
    // snapshot — so the drop/recreate is written out here and the snapshot is
    // updated to the expression form alongside it.
    //
    // NOTE: fails if duplicates already exist. Resolve them first.
    this.addSql(`drop index if exists "fleet_vehicles_plate_unique_idx";`);
    this.addSql(`create unique index "fleet_vehicles_plate_unique_idx" on "fleet_vehicles" ("organization_id", "tenant_id", "plate_number") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "fleet_vehicles_plate_unique_idx";`);
    this.addSql(`create index "fleet_vehicles_plate_unique_idx" on "fleet_vehicles" ("organization_id", "tenant_id", "plate_number");`);
    this.addSql(`drop index "fleet_vehicles_sequence_unique_idx";`);
  }

}
