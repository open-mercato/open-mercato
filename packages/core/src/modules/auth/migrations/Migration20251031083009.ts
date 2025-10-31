import { Migration } from '@mikro-orm/migrations'

export class Migration20251031083009 extends Migration {
  private readonly oldConstraint = 'roles_name_unique'
  private readonly newConstraint = 'roles_tenant_id_name_unique'

  async up(): Promise<void> {
    this.addSql(`alter table "roles" drop constraint if exists "${this.oldConstraint}";`)
    this.addSql(`alter table "roles" add constraint "${this.newConstraint}" unique ("tenant_id", "name");`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "roles" drop constraint if exists "${this.newConstraint}";`)
    this.addSql(`alter table "roles" add constraint "${this.oldConstraint}" unique ("name");`)
  }
}
