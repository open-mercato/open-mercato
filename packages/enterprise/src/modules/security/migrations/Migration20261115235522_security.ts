import { Migration } from '@mikro-orm/migrations';

export class Migration20261115235522_security extends Migration {

  override name = 'Migration20261115235522';

  override up(): void | Promise<void> {
    this.addSql(`create table "mfa_verification_states" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "attempts" int not null default 0, "reset_at" timestamptz not null, "locked_until" timestamptz null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "mfa_verification_states" add constraint "mfa_verification_states_tenant_id_user_id_unique" unique ("tenant_id", "user_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "mfa_verification_states";`);
  }

}
