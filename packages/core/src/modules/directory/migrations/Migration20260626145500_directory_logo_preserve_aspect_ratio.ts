import { Migration } from '@mikro-orm/migrations';

export class Migration20260626145500DirectoryLogoPreserveAspectRatio extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "organizations" add "logo_preserve_aspect_ratio" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "organizations" drop column "logo_preserve_aspect_ratio";`);
  }

}
