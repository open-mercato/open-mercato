import { Migration } from '@mikro-orm/migrations';

/**
 * Renames staff leave-request command IDs stored in messages.action_data
 * (the action buttons on inbox approval messages).
 *
 * Only rows whose action_data contains one of the old commandId values are
 * touched. Already-migrated rows are skipped by the EXISTS guard.
 */
export class Migration20260424130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      UPDATE messages
      SET action_data = jsonb_set(
        action_data,
        '{actions}',
        (
          SELECT jsonb_agg(
            CASE
              WHEN action->>'commandId' = 'staff.leave-requests.accept'
                THEN jsonb_set(action, '{commandId}', '"staff.leave-request.accept"')
              WHEN action->>'commandId' = 'staff.leave-requests.reject'
                THEN jsonb_set(action, '{commandId}', '"staff.leave-request.reject"')
              ELSE action
            END
          )
          FROM jsonb_array_elements(action_data->'actions') AS action
        )
      )
      WHERE deleted_at IS NULL
        AND action_data IS NOT NULL
        AND action_data ? 'actions'
        AND jsonb_typeof(action_data->'actions') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(action_data->'actions') AS action
          WHERE action->>'commandId' IN (
            'staff.leave-requests.accept',
            'staff.leave-requests.reject'
          )
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      UPDATE messages
      SET action_data = jsonb_set(
        action_data,
        '{actions}',
        (
          SELECT jsonb_agg(
            CASE
              WHEN action->>'commandId' = 'staff.leave-request.accept'
                THEN jsonb_set(action, '{commandId}', '"staff.leave-requests.accept"')
              WHEN action->>'commandId' = 'staff.leave-request.reject'
                THEN jsonb_set(action, '{commandId}', '"staff.leave-requests.reject"')
              ELSE action
            END
          )
          FROM jsonb_array_elements(action_data->'actions') AS action
        )
      )
      WHERE deleted_at IS NULL
        AND action_data IS NOT NULL
        AND action_data ? 'actions'
        AND jsonb_typeof(action_data->'actions') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(action_data->'actions') AS action
          WHERE action->>'commandId' IN (
            'staff.leave-request.accept',
            'staff.leave-request.reject'
          )
        );
    `);
  }

}
