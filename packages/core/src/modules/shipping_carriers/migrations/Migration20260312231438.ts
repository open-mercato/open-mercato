import { Migration } from '@mikro-orm/migrations';

export class Migration20260312231438 extends Migration {

  override async up(): Promise<void> {
    // Only shipping_carriers-specific changes. The original migration incorrectly
    // included FK drops/recreates for every module due to a stale ORM snapshot.
    this.addSql(`alter index if exists "carrier_shipments_organization_id_tenant_id_unif_b5ab4_index" rename to "carrier_shipments_organization_id_tenant_id_unifie_ffc31_index";`);
    this.addSql(`alter index if exists "carrier_shipments_provider_key_carrier_shipment_i_f9f17_index" rename to "carrier_shipments_provider_key_carrier_shipment_id_96494_index";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter index if exists "carrier_shipments_organization_id_tenant_id_unifie_ffc31_index" rename to "carrier_shipments_organization_id_tenant_id_unif_b5ab4_index";`);
    this.addSql(`alter index if exists "carrier_shipments_provider_key_carrier_shipment_id_96494_index" rename to "carrier_shipments_provider_key_carrier_shipment_i_f9f17_index";`);
  }

}
