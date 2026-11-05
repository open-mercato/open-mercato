import { Migration } from '@mikro-orm/migrations'

export class Migration20260410120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "integration_states" add column "last_health_latency_ms" int null;`)
    this.addSql(`alter table "integration_states" add column "enabled_at" timestamptz null;`)
  }
}
