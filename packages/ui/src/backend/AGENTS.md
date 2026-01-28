# Notes

- DataTable resolves default row-click behavior from `RowActions` item `id`s. Always set stable ids like `edit`, `open`, `delete`, etc.
- Customize which action ids are used for row clicks via the `rowClickActionIds` prop (defaults to `['edit', 'open']`).
