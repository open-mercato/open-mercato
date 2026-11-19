import { Migration } from '@mikro-orm/migrations';

export class Migration20261119031934_customer_accounts extends Migration {

  override name = 'Migration20261119031934';

  override up(): void | Promise<void> {
    this.addSql(`alter table "domain_mappings" add "deleted_at" timestamptz null, add "reserved_until" timestamptz null;`);
    this.addSql(`update "domain_mappings"
      set "status" = 'pending', "verified_at" = null, "last_dns_check_at" = null,
          "dns_failure_reason" = null, "tls_failure_reason" = null, "tls_retry_count" = 0, "updated_at" = now()
      where "status" in ('verified', 'tls_failed');`);
  }

  override down(): void | Promise<void> {
    this.addSql(`delete from "domain_mappings" where "deleted_at" is not null;`);
    this.addSql(`alter table "domain_mappings" drop column "deleted_at", drop column "reserved_until";`);
  }

}
