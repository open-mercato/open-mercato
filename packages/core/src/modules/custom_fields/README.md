Custom Fields module: stores dynamic field definitions and values (EAV) for any entity.

This module enables per-entity custom fields that users can define at runtime.
It holds two tables:
- custom_field_defs: field definitions (per entity, per organization)
- custom_field_values: field values (per entity record, per organization)

Query layer can join these for filtering and selection.

