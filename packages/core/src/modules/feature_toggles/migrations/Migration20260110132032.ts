import { Migration } from '@mikro-orm/migrations';

export class Migration20260110132032 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "feature_toggles" add column "default_value" jsonb null, add column "type" text null;`);

    this.addSql(`alter table "feature_toggle_overrides" add column "value" jsonb null;`);

    this.addSql(`update "feature_toggles" set "default_value" = to_jsonb("default_state"), "type" = 'boolean';`);

    this.addSql(`update "feature_toggle_overrides" set "value" = to_jsonb("state"::boolean);`);

    this.addSql(`alter table "feature_toggles" alter column "default_value" set not null, alter column "type" set not null;`);

    this.addSql(`alter table "feature_toggle_overrides" alter column "value" set not null;`);

    this.addSql(`alter table "feature_toggles" drop column "default_state", drop column "fail_mode";`);

    this.addSql(`alter table "feature_toggle_overrides" drop column "state";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "feature_toggles" drop column "default_value", drop column "type";`);

    this.addSql(`alter table "feature_toggles" add column "default_state" boolean not null, add column "fail_mode" text not null default 'fail_closed';`);

    this.addSql(`alter table "feature_toggle_overrides" drop column "value";`);

    this.addSql(`alter table "feature_toggle_overrides" add column "state" text not null;`);
  }

}
