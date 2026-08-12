# Optional plugin shared contracts must stay format-neutral

When a domain module declares data for an optional rendering plugin, `shared` should expose only the declaration contract needed by that domain module. Renderer formats, source implementations, loaded-template shapes, render inputs and outputs, UI filters, and runtime registry interfaces belong to the plugin. Keep extensible fields such as `format` and `source.type` as `string` at the shared boundary.
