# Core Pattern Catalog
One row per pattern. `Reach for when` = the code smell/trigger to detect. `Skip when` = the overfit guard.
Rows are detection recipes, not a checklist — a pattern must simplify or it is not applied.
[seed v1]

## Creational
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Factory Method | Let subclasses/config decide which concrete type to create | Constructing one of several types from a discriminator; `new` scattered across call sites | One concrete type, no variation foreseen |
| Abstract Factory | Create families of related objects together | Swappable product *families* (per-platform, per-tenant widgets/clients) | Only one family exists |
| Builder | Separate stepwise construction from representation | Constructors with 4+ params, telescoping ctors, many optionals | A parameter object or kwargs suffices |
| Prototype | New objects by cloning a configured instance | Expensive setup duplicated; templates stamped with tweaks | Construction is cheap |
| Singleton | Exactly one instance, global access | A genuinely single resource (process-wide config, connection registry) | Used as a global grab-bag; DI would serve — prefer DI |
| Dependency Injection | Receive collaborators instead of constructing them | Class news up its own DB/HTTP/clock; untestable without patching | Pure functions with no collaborators |
| Lazy Initialization | Defer creation until first use | Costly object often unused; startup-time pressure | Cost is trivial; adds thread-safety burden |
| Object Pool | Recycle expensive-to-create objects | Measured churn on connections/threads/buffers | Anything cheap — pools leak state |
| Multiton | One instance per key | Per-tenant/per-region singletons | A plain dict/map of instances is clearer |
| RAII | Tie resource lifetime to object scope | Manual acquire/release pairs that can leak on error paths | GC'd context (`with`/`try-with-resources` already covers it) |

## Structural
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Adapter | Convert an interface to what clients expect | Third-party/legacy API shape ≠ domain interface; SDK bleeding into core | You control both sides — change one |
| Bridge | Decouple abstraction from implementation so both vary | Class explosion across two axes (shape × renderer) | One axis varies — subclass or strategy |
| Composite | Treat part and whole uniformly as a tree | Recursive structures (org charts, ASTs, menus) with duplicated leaf/branch handling | Structure is flat |
| Decorator | Layer responsibilities without subclassing | Optional stackable behavior (retry, logging, caching) around a stable interface | One fixed extension — a subclass or wrapper fn is simpler |
| Facade | One simple interface over a subsystem | Callers orchestrate the same multi-step subsystem dance repeatedly | It would just rename one call |
| Flyweight | Share intrinsic state across many instances | Measured memory pressure from thousands of similar objects | Object counts are small |
| Proxy | Surrogate controls access to the real object | Lazy remote/expensive access, permission gating, caching layer | Nothing to control — call directly |
| Delegation | Extend via composition instead of inheritance | Inheriting for reuse where is-a doesn't hold | True is-a with LSP intact |
| Extension Object | Add per-type capabilities without touching the hierarchy | Optional capabilities on some subclasses; downcast-and-check creep | Capability belongs on the base |
| Front Controller | Single entry point for all requests | Cross-cutting auth/routing duplicated per handler | Framework already provides it |
| Module | Group related code behind one narrow surface | Serialization+validation+transport mixed in one file; "utils" dumping grounds | Already cohesive |
| Marker | Tag types with an empty interface | Compile-time classification hooks | Attributes/enums/annotations express it better |
| Twin | Simulate multiple inheritance | Language lacks MI and both parents are needed | Composition covers it (almost always) |

## Behavioral
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Strategy | Interchangeable algorithms behind one interface | Growing if/elif/switch on a type code *selecting an algorithm*; expected to grow | One branch exists; YAGNI — a strategy with one strategy is indirection |
| Chain of Responsibility | Pass request along handlers until one handles it | Ordered validators/fallbacks/escalations, each may handle or pass; middleware shapes | Fixed two-step sequence — just call both |
| Command | Reify an action as an object | Undo/redo, queues, scheduling, audit logs of operations | A plain callback/closure suffices |
| Observer | Notify dependents of state changes automatically | Multiple modules poll or are hand-notified of the same event; tight caller→listener coupling | One consumer, synchronous — call it |
| State | Behavior changes with internal state | State-dependent conditionals duplicated across methods; implicit state machine | Two trivial states |
| Template Method | Skeleton algorithm, steps deferred to subclasses | Sibling classes share an outline differing in 1–2 steps | Composition/strategy fits — prefer it |
| Mediator | Centralize many-to-many object interactions | Colleagues reference each other pairwise; N² coupling | Few objects, simple links |
| Memento | Capture/restore state without breaking encapsulation | Undo/rollback/snapshot needs | Serializing the object is acceptable |
| Iterator | Sequential access without exposing representation | Custom traversal over a nonstandard structure | Language iterators cover it |
| Visitor | New operations over a stable type hierarchy | Many operations over fixed node types (AST passes); type-switches multiplying | Hierarchy changes often — visitor calcifies it |
| Interpreter | Represent and evaluate a grammar | A real mini-language/rule syntax exists | It's config, not grammar — parse it plainly |
| Null Object | Default no-op object instead of null checks | `if x is not None` peppered around one optional collaborator | Optional/Maybe types express it natively |
| Specification | Composable boolean business rules | Filter/eligibility rules combined with and/or/not across contexts | One-off predicate — a lambda |
| Fluent Interface | Chainable API reading as a DSL | Building complex configs/queries; pairs with Builder | Simple args do it — chaining hides state |
| Blackboard | Multiple solvers contribute to shared workspace | Heterogeneous partial solvers converging on one problem (AI/recognition) | A pipeline is deterministic — use it |
| Servant | One helper serving a group of classes | Same behavior needed across unrelated types | It's one type's method |
