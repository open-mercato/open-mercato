import { Migration } from '@mikro-orm/migrations';

export class Migration20261022120000_customers extends Migration {

  override name = 'Migration20261022120000_customers';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_pipelines" add "stage_probabilities_enabled" boolean not null default false;`);
    this.addSql(`alter table "customer_pipeline_stages" add "default_probability" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_pipeline_stages" drop column "default_probability";`);
    this.addSql(`alter table "customer_pipelines" drop column "stage_probabilities_enabled";`);
  }

}
