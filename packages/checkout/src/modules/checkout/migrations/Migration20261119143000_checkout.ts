import { Migration } from '@mikro-orm/migrations'

export class Migration20261119143000_checkout extends Migration {
  override async up(): Promise<void> {
    this.addSql('lock table "checkout_links" in share row exclusive mode;')
    this.addSql('create table "checkout_link_slug_owners" ("id" uuid not null default gen_random_uuid(), "slug" text not null, "tenant_id" uuid null, constraint "checkout_link_slug_owners_pkey" primary key ("id"), constraint "checkout_link_slug_owners_slug_unique" unique ("slug"));')
    this.addSql(`
      insert into "checkout_link_slug_owners" ("slug", "tenant_id")
      select "slug", case when count(distinct "tenant_id") = 1 then min("tenant_id"::text)::uuid end
      from "checkout_links"
      group by "slug";
    `)

    this.addSql(`
      create function "checkout_reserve_link_slug"() returns trigger
      language plpgsql set search_path from current as $$
      begin
        if tg_op = 'UPDATE' then
          if new.slug = old.slug and new.tenant_id = old.tenant_id
            and (old.deleted_at is null or new.deleted_at is not null) then
            return new;
          end if;
        end if;

        insert into "checkout_link_slug_owners" ("slug", "tenant_id")
        values (new.slug, new.tenant_id)
        on conflict ("slug") do nothing;

        if not found and not exists (
          select 1 from "checkout_link_slug_owners"
          where "slug" = new.slug and "tenant_id" = new.tenant_id
        ) then
          raise unique_violation using
            message = 'Checkout link slug is reserved',
            constraint = 'checkout_link_slug_owners_slug_unique';
        end if;

        return new;
      end;
      $$;
    `)
    this.addSql(`
      create trigger "checkout_reserve_link_slug"
      before insert or update of "slug", "tenant_id", "deleted_at" on "checkout_links"
      for each row execute function "checkout_reserve_link_slug"();
    `)
  }

  override async down(): Promise<void> {
    this.addSql('drop trigger "checkout_reserve_link_slug" on "checkout_links";')
    this.addSql('drop function "checkout_reserve_link_slug"();')
    this.addSql('drop table "checkout_link_slug_owners";')
  }
}
