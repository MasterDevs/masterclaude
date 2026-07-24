# Data Pattern Catalog
One row per pattern. `Reach for when` = the code smell/trigger to detect. `Skip when` = the overfit guard.
Rows are detection recipes, not a checklist — a pattern must simplify or it is not applied. Learning fills this catalog over time.
[seed v1]

| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Normalize then denormalize deliberately | Model in normal form; denormalize only for measured read needs | Duplicated columns "for speed" with no measurement; update anomalies | Read path is not hot — keep it normalized |
| Soft Delete | Mark rows deleted instead of removing them | Need audit/undo/referential history on deletes | No recovery/audit need — a hard delete is simpler and every query must now filter `deleted_at IS NULL` |
| Event Sourcing | Persist state as an append-only event log | True audit/replay/temporal-query requirement; state is a fold over events | **Almost always** — enormous complexity; a table with an audit log usually suffices |
| Slowly Changing Dimensions | Track history of attribute changes over time | Analytics needs "value as of date"; dimensions mutate and history matters | Only current value ever queried |
| Idempotent Upsert | Insert-or-update so retries are safe | At-least-once writers; dedup on a natural key (`ON CONFLICT`/merge) | Inserts are naturally unique and never retried |
| Uniqueness under NULLs | Make NULL-bearing composite keys dedupe correctly | A unique constraint over nullable columns lets "all/whole" rollup rows duplicate (Postgres treats two NULLs as distinct) | No nullable columns in the key — `nulls_distinct=False` note applies only when NULL means "all" |
