import { Migration } from '@mikro-orm/migrations';

/**
 * Renames ACL feature IDs from plural entity segments to singular
 * (e.g. auth.users.list → auth.user.list) in role_acls and user_acls.
 *
 * Safe to re-run: the WHERE clause only matches rows that still contain
 * the old value, so rows already migrated are skipped.
 */
export class Migration20260423120000 extends Migration {

  override async up(): Promise<void> {
    // Rename all exact feature IDs and wildcard variants in one DO block.
    // Each pair is [old, new]. Wildcards (e.g. "auth.users.*") are included
    // because setup.ts defaultRoleFeatures may have written them to the DB.
    this.addSql(`
      DO $$
      DECLARE
        old_val text;
        new_val text;
        renames text[][] := ARRAY[
          -- auth
          ARRAY['auth.users.list',              'auth.user.list'],
          ARRAY['auth.users.create',            'auth.user.create'],
          ARRAY['auth.users.edit',              'auth.user.edit'],
          ARRAY['auth.users.delete',            'auth.user.delete'],
          ARRAY['auth.roles.list',              'auth.role.list'],
          ARRAY['auth.roles.manage',            'auth.role.manage'],
          ARRAY['auth.users.*',                 'auth.user.*'],
          ARRAY['auth.roles.*',                 'auth.role.*'],
          -- catalog
          ARRAY['catalog.products.view',        'catalog.product.view'],
          ARRAY['catalog.products.manage',      'catalog.product.manage'],
          ARRAY['catalog.categories.view',      'catalog.category.view'],
          ARRAY['catalog.categories.manage',    'catalog.category.manage'],
          ARRAY['catalog.variants.manage',      'catalog.variant.manage'],
          ARRAY['catalog.products.*',           'catalog.product.*'],
          ARRAY['catalog.categories.*',         'catalog.category.*'],
          ARRAY['catalog.variants.*',           'catalog.variant.*'],
          -- customers
          ARRAY['customers.people.view',        'customers.person.view'],
          ARRAY['customers.people.manage',      'customers.person.manage'],
          ARRAY['customers.companies.view',     'customers.company.view'],
          ARRAY['customers.companies.manage',   'customers.company.manage'],
          ARRAY['customers.deals.view',         'customers.deal.view'],
          ARRAY['customers.deals.manage',       'customers.deal.manage'],
          ARRAY['customers.activities.view',    'customers.activity.view'],
          ARRAY['customers.activities.manage',  'customers.activity.manage'],
          ARRAY['customers.people.*',           'customers.person.*'],
          ARRAY['customers.companies.*',        'customers.company.*'],
          ARRAY['customers.deals.*',            'customers.deal.*'],
          ARRAY['customers.activities.*',       'customers.activity.*'],
          -- directory
          ARRAY['directory.tenants.view',       'directory.tenant.view'],
          ARRAY['directory.tenants.manage',     'directory.tenant.manage'],
          ARRAY['directory.organizations.view', 'directory.organization.view'],
          ARRAY['directory.organizations.manage','directory.organization.manage'],
          ARRAY['directory.tenants.*',          'directory.tenant.*'],
          ARRAY['directory.organizations.*',    'directory.organization.*'],
          -- sales
          ARRAY['sales.orders.view',            'sales.order.view'],
          ARRAY['sales.orders.manage',          'sales.order.manage'],
          ARRAY['sales.orders.approve',         'sales.order.approve'],
          ARRAY['sales.quotes.view',            'sales.quote.view'],
          ARRAY['sales.quotes.manage',          'sales.quote.manage'],
          ARRAY['sales.shipments.manage',       'sales.shipment.manage'],
          ARRAY['sales.payments.manage',        'sales.payment.manage'],
          ARRAY['sales.invoices.manage',        'sales.invoice.manage'],
          ARRAY['sales.credit_memos.manage',    'sales.credit_memo.manage'],
          ARRAY['sales.channels.manage',        'sales.channel.manage'],
          ARRAY['sales.orders.*',               'sales.order.*'],
          ARRAY['sales.quotes.*',               'sales.quote.*'],
          ARRAY['sales.shipments.*',            'sales.shipment.*'],
          ARRAY['sales.payments.*',             'sales.payment.*'],
          ARRAY['sales.invoices.*',             'sales.invoice.*'],
          ARRAY['sales.credit_memos.*',         'sales.credit_memo.*'],
          ARRAY['sales.channels.*',             'sales.channel.*'],
          -- example
          ARRAY['example.todos.view',           'example.todo.view'],
          ARRAY['example.todos.manage',         'example.todo.manage'],
          ARRAY['example.todos.*',              'example.todo.*']
        ];
        pair text[];
      BEGIN
        FOREACH pair SLICE 1 IN ARRAY renames LOOP
          old_val := pair[1];
          new_val := pair[2];

          UPDATE role_acls
          SET
            features_json = (
              SELECT jsonb_agg(
                CASE WHEN elem = to_jsonb(old_val) THEN to_jsonb(new_val) ELSE elem END
              )
              FROM jsonb_array_elements(features_json) AS elem
            ),
            updated_at = now()
          WHERE deleted_at IS NULL
            AND features_json IS NOT NULL
            AND jsonb_typeof(features_json) = 'array'
            AND features_json ? old_val;

          UPDATE user_acls
          SET
            features_json = (
              SELECT jsonb_agg(
                CASE WHEN elem = to_jsonb(old_val) THEN to_jsonb(new_val) ELSE elem END
              )
              FROM jsonb_array_elements(features_json) AS elem
            ),
            updated_at = now()
          WHERE deleted_at IS NULL
            AND features_json IS NOT NULL
            AND jsonb_typeof(features_json) = 'array'
            AND features_json ? old_val;

        END LOOP;
      END $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      DO $$
      DECLARE
        old_val text;
        new_val text;
        renames text[][] := ARRAY[
          ARRAY['auth.user.list',              'auth.users.list'],
          ARRAY['auth.user.create',            'auth.users.create'],
          ARRAY['auth.user.edit',              'auth.users.edit'],
          ARRAY['auth.user.delete',            'auth.users.delete'],
          ARRAY['auth.role.list',              'auth.roles.list'],
          ARRAY['auth.role.manage',            'auth.roles.manage'],
          ARRAY['auth.user.*',                 'auth.users.*'],
          ARRAY['auth.role.*',                 'auth.roles.*'],
          ARRAY['catalog.product.view',        'catalog.products.view'],
          ARRAY['catalog.product.manage',      'catalog.products.manage'],
          ARRAY['catalog.category.view',       'catalog.categories.view'],
          ARRAY['catalog.category.manage',     'catalog.categories.manage'],
          ARRAY['catalog.variant.manage',      'catalog.variants.manage'],
          ARRAY['catalog.product.*',           'catalog.products.*'],
          ARRAY['catalog.category.*',          'catalog.categories.*'],
          ARRAY['catalog.variant.*',           'catalog.variants.*'],
          ARRAY['customers.person.view',       'customers.people.view'],
          ARRAY['customers.person.manage',     'customers.people.manage'],
          ARRAY['customers.company.view',      'customers.companies.view'],
          ARRAY['customers.company.manage',    'customers.companies.manage'],
          ARRAY['customers.deal.view',         'customers.deals.view'],
          ARRAY['customers.deal.manage',       'customers.deals.manage'],
          ARRAY['customers.activity.view',     'customers.activities.view'],
          ARRAY['customers.activity.manage',   'customers.activities.manage'],
          ARRAY['customers.person.*',          'customers.people.*'],
          ARRAY['customers.company.*',         'customers.companies.*'],
          ARRAY['customers.deal.*',            'customers.deals.*'],
          ARRAY['customers.activity.*',        'customers.activities.*'],
          ARRAY['directory.tenant.view',       'directory.tenants.view'],
          ARRAY['directory.tenant.manage',     'directory.tenants.manage'],
          ARRAY['directory.organization.view', 'directory.organizations.view'],
          ARRAY['directory.organization.manage','directory.organizations.manage'],
          ARRAY['directory.tenant.*',          'directory.tenants.*'],
          ARRAY['directory.organization.*',    'directory.organizations.*'],
          ARRAY['sales.order.view',            'sales.orders.view'],
          ARRAY['sales.order.manage',          'sales.orders.manage'],
          ARRAY['sales.order.approve',         'sales.orders.approve'],
          ARRAY['sales.quote.view',            'sales.quotes.view'],
          ARRAY['sales.quote.manage',          'sales.quotes.manage'],
          ARRAY['sales.shipment.manage',       'sales.shipments.manage'],
          ARRAY['sales.payment.manage',        'sales.payments.manage'],
          ARRAY['sales.invoice.manage',        'sales.invoices.manage'],
          ARRAY['sales.credit_memo.manage',    'sales.credit_memos.manage'],
          ARRAY['sales.channel.manage',        'sales.channels.manage'],
          ARRAY['sales.order.*',               'sales.orders.*'],
          ARRAY['sales.quote.*',               'sales.quotes.*'],
          ARRAY['sales.shipment.*',            'sales.shipments.*'],
          ARRAY['sales.payment.*',             'sales.payments.*'],
          ARRAY['sales.invoice.*',             'sales.invoices.*'],
          ARRAY['sales.credit_memo.*',         'sales.credit_memos.*'],
          ARRAY['sales.channel.*',             'sales.channels.*'],
          ARRAY['example.todo.view',           'example.todos.view'],
          ARRAY['example.todo.manage',         'example.todos.manage'],
          ARRAY['example.todo.*',              'example.todos.*']
        ];
        pair text[];
      BEGIN
        FOREACH pair SLICE 1 IN ARRAY renames LOOP
          old_val := pair[1];
          new_val := pair[2];

          UPDATE role_acls
          SET
            features_json = (
              SELECT jsonb_agg(
                CASE WHEN elem = to_jsonb(old_val) THEN to_jsonb(new_val) ELSE elem END
              )
              FROM jsonb_array_elements(features_json) AS elem
            ),
            updated_at = now()
          WHERE deleted_at IS NULL
            AND features_json IS NOT NULL
            AND jsonb_typeof(features_json) = 'array'
            AND features_json ? old_val;

          UPDATE user_acls
          SET
            features_json = (
              SELECT jsonb_agg(
                CASE WHEN elem = to_jsonb(old_val) THEN to_jsonb(new_val) ELSE elem END
              )
              FROM jsonb_array_elements(features_json) AS elem
            ),
            updated_at = now()
          WHERE deleted_at IS NULL
            AND features_json IS NOT NULL
            AND jsonb_typeof(features_json) = 'array'
            AND features_json ? old_val;

        END LOOP;
      END $$;
    `);
  }

}
