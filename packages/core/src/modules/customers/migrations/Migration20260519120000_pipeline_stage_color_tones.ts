import { Migration } from '@mikro-orm/migrations';

/**
 * Migrate `customer_dictionary_entries.color` for `kind = 'pipeline_stage'` rows from the
 * legacy hex chip values stored by AddStageDialog to canonical semantic tone identifiers
 * matching Lane.tsx's `ACCENT_TONE_CLASS` map.
 *
 * Before this migration:
 *   AddStageDialog stored a hex value like '#16a34a' / '#f59e0b' / '#dc2626' / '#2563eb' /
 *   '#6b7280' / '#7c3aed', and Lane.tsx implicitly fell through to gray on every other hex
 *   because no explicit hex→tone map existed at render time.
 *
 * After this migration:
 *   `color` stores one of: 'success', 'warning', 'info', 'error', 'neutral', 'brand',
 *   'pink', '', or NULL. Lane.tsx now reads the value directly as a tone identifier.
 *
 * Unknown / unmappable hex values collapse to 'neutral'. Forward-only — reverting tones to
 * the original hex is lossy and not supported. See `.ai/specs/2026-05-19-customers-deals-kanban-ux-review-fixes.md`.
 */
export class Migration20260519120000_pipeline_stage_color_tones extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`
      update "customer_dictionary_entries"
      set "color" = case lower("color")
        when '#16a34a' then 'success'
        when '#22c55e' then 'success'
        when '#15803d' then 'success'
        when '#10b981' then 'success'
        when '#059669' then 'success'
        when '#f59e0b' then 'warning'
        when '#eab308' then 'warning'
        when '#d97706' then 'warning'
        when '#f97316' then 'warning'
        when '#ea580c' then 'warning'
        when '#dc2626' then 'error'
        when '#ef4444' then 'error'
        when '#b91c1c' then 'error'
        when '#991b1b' then 'error'
        when '#2563eb' then 'info'
        when '#3b82f6' then 'info'
        when '#0ea5e9' then 'info'
        when '#1d4ed8' then 'info'
        when '#6366f1' then 'info'
        when '#6b7280' then 'neutral'
        when '#9ca3af' then 'neutral'
        when '#4b5563' then 'neutral'
        when '#374151' then 'neutral'
        when '#1f2937' then 'neutral'
        when '#7c3aed' then 'brand'
        when '#8b5cf6' then 'brand'
        when '#a855f7' then 'brand'
        when '#9333ea' then 'brand'
        when '#ec4899' then 'pink'
        when '#f472b6' then 'pink'
        when '#db2777' then 'pink'
        when '#be185d' then 'pink'
        when '' then ''
        else 'neutral'
      end
      where "kind" = 'pipeline_stage'
        and "color" is not null;
    `);
  }

  override down(): void | Promise<void> {
    // Forward-only migration. Reverting tone identifiers to their original hex values is
    // lossy (we only kept the closest tone, not the source hex) and would not restore the
    // pre-migration state. Operators wanting to change a stage color should reopen the
    // AddStageDialog tone picker.
  }
}
