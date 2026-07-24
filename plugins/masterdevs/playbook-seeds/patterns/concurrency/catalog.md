# Concurrency Pattern Catalog
One row per pattern. `Reach for when` = the code smell/trigger to detect. `Skip when` = the overfit guard.
Rows are detection recipes, not a checklist — a pattern must simplify or it is not applied.
[seed v1]

| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Thread Pool | Reuse workers over a task queue | Spawning a thread/process per task; bursty parallel work | Runtime executor/event loop already provides |
| Active Object | Decouple invocation from execution (async proxy + queue) | Callers block on a resource that should serialize work privately | async/await idioms cover it |
| Monitor Object | Mutual exclusion + condition waiting per object | Shared mutable object accessed by many threads | Data can be immutable/thread-local instead |
| Lock / Mutex | Exclusive access to shared state | Any read-modify-write on shared data | Ownership can be exclusive by design |
| Read-Write Lock | Concurrent reads, exclusive writes | Read-heavy shared structure with rare writes | Contention unmeasured — start with plain lock |
| Guarded Suspension | Wait until precondition holds before proceeding | Consumer must block until state/queue ready | Timeout/polling semantics wanted instead |
| Balking | Refuse action unless in correct state | Duplicate triggers must no-op (already-running job) | Callers should queue, not be refused |
| Double-Checked Locking | Cheap pre-lock check for one-time init | Hot-path lazy singleton init, measured lock cost | Language gives safe lazy init (statics, once) |
| Scheduler | Explicit policy for which thread runs when | Fairness/priority control over waiting work | OS/runtime scheduling suffices |
| Reactor | Demultiplex events to handlers on one thread | Many connections, non-blocking IO, single-threaded dispatch | Platform event loop already is one |
| Proactor / Event-Based Async | Completion-based async operations | High-throughput IO with completion callbacks | async/await abstracts it |
| Join / Message Passing | Coordinate via messages, not shared memory | Cross-thread/process coordination; shared state causing races | Single-threaded context |
| Barrier | All parties reach a point before any proceed | Phased parallel computation | Phases are independent |
| Thread-Specific Storage | Per-thread globals | Context (request id, txn) needed down-stack without threading params | Explicit parameter passing is feasible — prefer it |
| Binding Properties | Keep properties synchronized across objects | UI/model sync with manual change propagation | Framework reactivity exists |
| Compute Kernel | Same op over large data in parallel | SIMD/GPU-shaped numeric work | Data too small to amortize |
| Service Handler per Request | Dedicated handler per connection | Simple servers, low connection counts | High concurrency — use pool/reactor |
| Exclusive Ownership | Prove single ownership; no runtime locks | Language supports it (Rust, C++ moves) — races by construction | — |
| CPU Atomics | Lock-free primitives for tiny critical sections | Counters/flags where lock overhead measured | Anything compound — compose under a lock |
