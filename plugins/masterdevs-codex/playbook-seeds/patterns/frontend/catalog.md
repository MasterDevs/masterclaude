# Frontend Pattern Catalog
One row per pattern. `Reach for when` = the code smell/trigger to detect. `Skip when` = the overfit guard.
Rows are detection recipes, not a checklist — a pattern must simplify or it is not applied. Learning fills this catalog over time.
[seed v1]

| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Container/Presentational | Split data-fetching from rendering | One component both fetches/derives state and renders complex markup; hard to test view in isolation | Component is trivially small; hooks already isolate the data |
| Compound Components | Related components share implicit state via context | Parent passes the same props through many children (prop-drilling a widget's config) | A single flat component with props is clearer |
| Render Props / Hook extraction | Reuse stateful behavior across components | Same effect/subscription/derived-state logic copy-pasted between components | Logic used once — inline it |
| Optimistic Update | Reflect a mutation in UI before the server confirms | User-perceived latency on high-confidence writes (likes, toggles, reorders) | Failure is costly/ambiguous (payments) — wait for confirmation |
| Skeleton Screen | Placeholder layout during load | Perceived-performance on content that takes >~300ms; layout shift on load | Instant data; a spinner suffices for rare short waits |
