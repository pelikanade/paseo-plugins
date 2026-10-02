# Inline protocol version 1

Use a fenced block whose language is `paseo-ui`. Its first line is `{"cardId":"unique-card-id","catalogVersion":1}`. Each subsequent line is one JSON Patch operation. Use one complete JSON object per line and close the fence when finished. Prose may precede or follow the block.

The initial document is `{"root":null,"elements":{},"state":{}}`. Add state and complete elements before referencing them from the root. Element props must already resolve to valid values when each patch is applied. Add an entire element in one operation; do not construct a temporarily invalid element field by field.

Example:

````text
Here are the results:

```paseo-ui
{"cardId":"result-summary","catalogVersion":1}
{"op":"add","path":"/elements/card","value":{"type":"Card","props":{"title":"Results"},"children":["metric"]}}
{"op":"add","path":"/elements/metric","value":{"type":"Metric","props":{"label":"Matching items","value":12},"children":[]}}
{"op":"replace","path":"/root","value":"card"}
```
````

Only `add`, `replace` and `remove` are supported. Paths address `/root`, `/elements` or `/state` using JSON Pointer escapes. Do not use `move`, `copy`, `test`, repeat directives, watchers, named slots, computed functions, custom directives or state-changing actions. The current expression vocabulary is `$state` and `$bindState`.

Keep ordinary JSON and code examples outside `paseo-ui` fences. Streaming cards are read-only; submit buttons are enabled only after server registration of a valid completed message.
