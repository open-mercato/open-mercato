import { Migration } from '@mikro-orm/migrations';

export class Migration20260811143757_security extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sudo_sessions" add "scope_tenant_id" uuid null, add "scope_organization_id" uuid null, add "target_identifier" text null, add "sudo_config_id" uuid null, add "sudo_config_updated_at" timestamptz null, add "verified_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sudo_sessions" drop column "scope_tenant_id", drop column "scope_organization_id", drop column "target_identifier", drop column "sudo_config_id", drop column "sudo_config_updated_at", drop column "verified_at";`);
  }

}
