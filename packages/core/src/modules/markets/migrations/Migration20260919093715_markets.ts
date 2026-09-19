import { Migration } from '@mikro-orm/migrations';

export class Migration20260919093715_markets extends Migration {

  override name = 'Migration20260919093715';

  override up(): void | Promise<void> {
    this.addSql(`create table "market_display_profiles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "language_tag" text not null, "currency_code" text not null, "currency_display" text not null default 'symbol', "decimal_separator" text null, "thousands_separator" text null, "negative_style" text not null default 'minus', "date_format" text not null, "date_time_format" text not null, "time_format" text not null, "hour_cycle" text not null default 'h23', "first_day_of_week" int not null default 1, "time_zone" text not null, "address_layout" text not null default 'line_first', "default_country_code" text not null, "subdivision_required" boolean not null default false, "postal_code_pattern" text null, "postal_code_label_key" text not null, "subdivision_label_key" text not null, "address_line2_label_key" text not null, "phone_national_pattern" text null, "phone_default_dial_code" text null, "measurement_system" text not null default 'metric', "default_weight_unit" text not null default 'kg', "default_length_unit" text not null default 'cm', "length_display" text not null default 'decimal', "paper_size" text not null default 'a4', "price_presentation" text not null default 'dual_net_gross', "tax_line_label_key" text not null, "tax_note_key" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "market_display_profiles" add constraint "market_display_profiles_scope_unique" unique ("organization_id", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "market_display_profiles" cascade;`);
  }

}
