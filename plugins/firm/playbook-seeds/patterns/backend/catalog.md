# Backend Pattern Catalog
One row per pattern. `Reach for when` = the code smell/trigger to detect. `Skip when` = the overfit guard.
Rows are detection recipes, not a checklist — a pattern must simplify or it is not applied. Learning fills this catalog over time.
[seed v1]

| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Repository | Abstract persistence behind a collection-like interface | ORM/query calls scattered through business logic; can't test logic without a DB | Thin CRUD with no domain logic — the ORM is already the repository |
| Unit of Work | Commit a set of changes as one transaction | Multi-entity writes that must all-or-nothing; per-call commits risking partial state | A single write — the DB call is already atomic |
| Service Layer | House use-case orchestration above the domain | Controllers/handlers growing fat with business rules; same flow reused across transports | Logic belongs on one entity — don't add an anemic passthrough |
| Anti-Corruption Layer | Translate an external model into your domain's terms | Third-party/legacy vocabulary leaking into core types | You own both models |
| Circuit Breaker | Stop calling a failing dependency, fail fast | Repeated timeouts to a flaky dependency cascading into your latency | Dependency is in-process/reliable |
| Retry-with-Backoff | Retry transient failures with increasing delay | Idempotent calls to networked dependencies with transient errors | Non-idempotent op without dedup; failures are permanent |
| Outbox | Publish events atomically with the DB write | Dual-write to DB + broker that can diverge on crash | No event publishing, or broker join a real transaction |
| Saga (see Process Manager) | Coordinate a distributed transaction via compensations | Multi-service workflow with no shared transaction; needs rollback steps | Single-service transaction covers it |
| CQRS | Separate the write model from the read model | Read and write shapes/scaling genuinely diverge; complex reporting over a rich write model | **Most CRUD apps** — the split doubles the code for no gain |
