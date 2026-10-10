import { Migration } from '@mikro-orm/migrations';

export class Migration20261010042043_freight_operations extends Migration {

  override name = 'Migration20261010042043';

  override up(): void | Promise<void> {
    this.addSql(`alter table "freight_contract_routes" add "vehicle_type_id" uuid null, add "equipment_type" text null, add "driver_incentive_type" text not null default 'none', add "driver_incentive_value" numeric(18,4) null;`);
    this.addSql(`alter table "freight_contract_routes" add constraint "freight_contract_routes_driver_incentive_type_check" check ("driver_incentive_type" in ('none', 'per_trip', 'per_km', 'per_hour', 'percentage_of_rate', 'fixed_monthly'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "freight_contract_routes" drop constraint if exists "freight_contract_routes_driver_incentive_type_check";`);
    this.addSql(`alter table "freight_contract_routes" drop column "vehicle_type_id", drop column "equipment_type", drop column "driver_incentive_type", drop column "driver_incentive_value";`);
  }

}
