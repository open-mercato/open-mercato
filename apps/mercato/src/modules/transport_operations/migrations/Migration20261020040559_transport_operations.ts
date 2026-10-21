import { Migration } from '@mikro-orm/migrations';

/**
 * M4.1 — the fleet register moves into transport_operations.
 *
 * The vehicle columns the fleet screen needs are added to `transport_vehicles`,
 * existing fleet rows are copied in (or matched to an existing transport row by
 * plate within the same tenant/organization), the fleet child rows are repointed,
 * and the duplicate `fleet_vehicles` table is dropped. The copy is deliberately
 * conservative: an unmatched fleet row is inserted with its own id (so every
 * child reference stays valid), a matched row is merged into the existing
 * transport id, and a sequence-number collision fails the migration instead of
 * silently rewriting data.
 *
 * This migration lives in `transport_operations` on purpose: migrations run
 * module-by-module in alphabetical order, so `fleet_management` is processed
 * first and the legacy table is still present when this file runs.
 */
export class Migration20261020040559_transport_operations extends Migration {

  override name = 'Migration20261020040559';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transport_vehicles" add "sequence_number" text null, add "color" text null, add "vehicle_type" text null, add "current_odometer" int not null default 0, add "notes" text null;`);
    this.addSql(`alter table "transport_vehicles" alter column "capacity" set default 0;`);
    this.addSql(`alter table "transport_vehicles" alter column "vin" drop not null;`);
    this.addSql(`create unique index "transport_vehicles_sequence_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "sequence_number") where deleted_at is null and sequence_number is not null;`);

    this.addSql(`do $$
    begin
      if to_regclass('fleet_vehicles') is not null then
        insert into "transport_vehicles" (
          "id", "tenant_id", "organization_id", "plate_number", "vin", "sequence_number",
          "make", "model", "year", "capacity", "color", "vehicle_type", "current_odometer",
          "notes", "status", "telematics_device_id", "created_by", "created_at", "updated_at", "deleted_at"
        )
        select
          fv."id", fv."tenant_id", fv."organization_id", fv."plate_number", null, fv."sequence_number",
          fv."make", fv."model", fv."year", 0, fv."color", fv."vehicle_type", coalesce(fv."current_odometer", 0),
          fv."notes",
          case
            when fv."status" = 'maintenance' then 'maintenance'
            when fv."status" = 'out_of_service' then 'out_of_service'
            else 'active'
          end,
          null, fv."created_by", fv."created_at", fv."updated_at", fv."deleted_at"
        from "fleet_vehicles" fv
        where not exists (
          select 1 from "transport_vehicles" tv
          where tv."organization_id" = fv."organization_id"
            and tv."tenant_id" = fv."tenant_id"
            and tv."plate_number" = fv."plate_number"
            and tv."deleted_at" is null
        );

        update "fleet_vehicle_documents" d
        set "vehicle_id" = tv."id"
        from "fleet_vehicles" fv
        join "transport_vehicles" tv
          on tv."organization_id" = fv."organization_id"
         and tv."tenant_id" = fv."tenant_id"
         and tv."plate_number" = fv."plate_number"
         and tv."deleted_at" is null
        where d."vehicle_id" = fv."id" and tv."id" <> fv."id";

        update "fleet_vehicle_assignments" a
        set "vehicle_id" = tv."id"
        from "fleet_vehicles" fv
        join "transport_vehicles" tv
          on tv."organization_id" = fv."organization_id"
         and tv."tenant_id" = fv."tenant_id"
         and tv."plate_number" = fv."plate_number"
         and tv."deleted_at" is null
        where a."vehicle_id" = fv."id" and tv."id" <> fv."id";

        update "fleet_vehicle_odometer_logs" l
        set "vehicle_id" = tv."id"
        from "fleet_vehicles" fv
        join "transport_vehicles" tv
          on tv."organization_id" = fv."organization_id"
         and tv."tenant_id" = fv."tenant_id"
         and tv."plate_number" = fv."plate_number"
         and tv."deleted_at" is null
        where l."vehicle_id" = fv."id" and tv."id" <> fv."id";

        drop table "fleet_vehicles";
      end if;
    end $$;`);
  }

  override down(): void | Promise<void> {
    // Best-effort rollback: recreate the legacy table from the register. The
    // reliable rollback for a destructive consolidation is the pre-migration
    // backup; this keeps the schema reversible for local development.
    this.addSql(`create table "fleet_vehicles" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null, "organization_id" uuid not null,
      "plate_number" text not null, "sequence_number" text null,
      "make" text not null, "model" text not null, "year" int not null,
      "color" text null, "vehicle_type" text null,
      "status" text not null default 'active',
      "current_odometer" int not null default 0,
      "assigned_employee_id" uuid null, "notes" text null,
      "created_by" uuid null, "created_at" timestamptz not null,
      "updated_at" timestamptz not null, "deleted_at" timestamptz null,
      primary key ("id")
    );`);
    this.addSql(`create unique index "fleet_vehicles_plate_unique_idx" on "fleet_vehicles" ("organization_id", "tenant_id", "plate_number") where deleted_at is null;`);
    this.addSql(`create unique index "fleet_vehicles_sequence_unique_idx" on "fleet_vehicles" ("organization_id", "tenant_id", "sequence_number") where deleted_at is null and sequence_number is not null;`);
    this.addSql(`insert into "fleet_vehicles" (
        "id", "tenant_id", "organization_id", "plate_number", "sequence_number",
        "make", "model", "year", "color", "vehicle_type", "status", "current_odometer",
        "assigned_employee_id", "notes", "created_by", "created_at", "updated_at", "deleted_at"
      )
      select tv."id", tv."tenant_id", tv."organization_id", tv."plate_number", tv."sequence_number",
        tv."make", tv."model", tv."year", tv."color", tv."vehicle_type",
        case when exists (
          select 1 from "fleet_vehicle_assignments" a
          where a."vehicle_id" = tv."id" and a."deleted_at" is null
            and a."status" in ('pending_approval', 'active')
        ) then 'assigned' else tv."status" end,
        coalesce(tv."current_odometer", 0),
        (select a."employee_id" from "fleet_vehicle_assignments" a
         where a."vehicle_id" = tv."id" and a."deleted_at" is null
           and a."status" in ('pending_approval', 'active')
         order by a."created_at" desc limit 1),
        tv."notes", tv."created_by", tv."created_at", tv."updated_at", tv."deleted_at"
      from "transport_vehicles" tv;`);
    this.addSql(`drop index "transport_vehicles_sequence_unique_idx";`);
    this.addSql(`alter table "transport_vehicles" drop column "sequence_number", drop column "color", drop column "vehicle_type", drop column "current_odometer", drop column "notes";`);
    this.addSql(`alter table "transport_vehicles" alter column "capacity" drop default;`);
  }

}
