# Integration Pattern Catalog (Enterprise Integration Patterns)
One row per pattern. `Reach for when` = the code smell/trigger to detect. `Skip when` = the overfit guard.
Rows are detection recipes, not a checklist — a pattern must simplify or it is not applied.
[seed v1]

*Integration styles (context, not triggers): File Transfer, Shared Database, Remote Procedure Invocation, Messaging — prefer Messaging for loose coupling; the rows below assume it.*

## Channels
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Point-to-Point Channel | Exactly one consumer receives each message | Commands/work items that must be processed once | Multiple consumers need the event |
| Publish-Subscribe Channel | Broadcast to all subscribers | Events with multiple independent consumers | Only one consumer exists today AND ever |
| Datatype Channel | One channel per message type | Consumers type-switch on a mixed channel | Types share one schema |
| Invalid Message Channel | Route unparseable messages aside | Malformed input crashing/blocking consumers | — (always have one) |
| Dead Letter Channel | Park undeliverable/expired messages | Retries exhausted; poison messages looping | — (always have one) |
| Guaranteed Delivery | Persist messages through crashes | Loss is unacceptable (payments, orders) | Loss-tolerant telemetry — cost unjustified |
| Channel Adapter | Connect a non-messaging system to messaging | Legacy/third-party system needs to emit/consume | System speaks the bus natively |
| Messaging Bridge | Connect two messaging systems | Two brokers/vendors must interoperate | One broker can own both sides |
| Message Bus | Shared backbone with common schema | Many systems integrating pairwise (N² adapters) | Two systems — a bridge is enough |

## Construction
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Command Message | Invoke a procedure via message | Sender wants an action performed | It's a fact, not an order → Event |
| Document Message | Transfer data, receiver decides usage | Sharing state/records | Receiver must act → Command |
| Event Message | Announce something happened | Decoupled reactions to a fact | Sender needs the outcome → Request-Reply |
| Request-Reply | Two-way conversation over messaging | Caller needs an answer asynchronously | Fire-and-forget suffices |
| Return Address | Tell replier where to send the reply | Multiple requestors share a service | Fixed single requestor |
| Correlation Identifier | Match replies to requests | Async replies arrive out of order | Synchronous call — no correlation needed |
| Message Sequence | Send data as ordered numbered parts | Payload exceeds message size limits | Claim Check fits better (store + reference) |
| Message Expiration | Discard stale messages | Data is time-limited (quotes, presence) | Late processing still valid |
| Format Indicator | Version/format field in the message | Schema will evolve under live consumers | — (always version) |

## Routing
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Content-Based Router | Route by message content | Consumers own disjoint cases of one stream | Pub-sub + filters is looser coupling |
| Message Filter | Drop non-matching messages | Consumer wants a subset of a topic | Router should direct instead of drop |
| Dynamic Router | Routing rules configurable at runtime | Destinations change without redeploys | Static routes — keep it simple |
| Recipient List | Compute recipients per message, send to each | Per-message fan-out driven by data | Fixed audience → Pub-Sub |
| Splitter | Break composite message into parts | Order-with-line-items processed per item | Downstream needs the whole |
| Aggregator | Combine related messages into one | Collecting split/scattered results; needs correlation + completeness + timeout | Parts are independent end-to-end |
| Resequencer | Restore order to a stream | Out-of-order arrival breaks consumers | Consumers are order-agnostic (prefer designing so) |
| Composed Message Processor | Split, route parts, re-aggregate | Parts need different processing then a combined answer | One-way fan-out → Splitter alone |
| Scatter-Gather | Broadcast a question, aggregate answers | Best-quote/consensus across N providers | One authoritative source exists |
| Routing Slip | Attach the step-sequence to the message | Per-message processing paths, steps known upfront | Central state/branching needed → Process Manager |
| Process Manager | Central stateful orchestration | Multi-step flows with branching, compensation, timeouts (sagas) | A linear pipeline — slips/chains suffice |
| Message Broker | Central hub decouples senders/receivers | Many-to-many routing sprawl | Two parties |

## Transformation
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Envelope Wrapper | Wrap payload with infrastructure metadata | Transport needs headers the payload shouldn't carry | Broker headers already cover it |
| Content Enricher | Add data the source lacks | Receiver needs fields sender can't supply (lookup on the way) | Receiver can look it up as cheaply |
| Content Filter | Strip data the receiver shouldn't see | Oversized/sensitive payloads crossing boundaries (PII!) | Receiver is trusted and needs it all |
| Claim Check | Store payload, pass a reference | Large blobs through the bus; re-attach later | Payloads are small |
| Normalizer | Convert variant formats to one canonical form | Same semantic message arrives in N formats | Single source, single format |
| Canonical Data Model | Shared model decouples app formats | N systems translating pairwise (N² mappings) | Two systems — direct map is cheaper |

## Endpoints
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Messaging Gateway | Hide messaging API behind a domain interface | Business code building messages by hand | — (default at boundaries; pairs with Adapter) |
| Messaging Mapper | Map domain objects ↔ messages, neither knows the other | Serialization logic bleeding into entities | DTO + gateway covers it |
| Transactional Client | Message ops join a transaction | Consume+DB-write must commit atomically | Idempotency makes at-least-once safe (prefer that) |
| Polling Consumer | Client pulls when ready | Consumer controls pace/backpressure | Push fits and latency matters |
| Event-Driven Consumer | Handler invoked on arrival | Low latency, runtime manages dispatch | Pace control needed → poll |
| Competing Consumers | Multiple consumers race one queue | Throughput scaling on point-to-point work | Strict ordering required (or partition first) |
| Message Dispatcher | One receiver distributes to performers | Ordered receipt + parallel processing; consumer-side routing | Broker-competing consumers already do it |
| Selective Consumer | Consume only matching messages | Consumer owns a filter the broker can apply | Filter belongs in a router/filter upstream |
| Durable Subscriber | Missed pub-sub messages held while offline | Subscriber outages must not lose events | Loss-tolerant streams |
| Idempotent Receiver | Handle duplicates safely | At-least-once delivery anywhere upstream | Exactly-once truly guaranteed (rare — assume dupes) |
| Service Activator | Expose a service via messaging and direct calls | Same logic needed sync and async | One access style only |

## System Management
| Pattern | Intent | Reach for when | Skip when |
|---|---|---|---|
| Control Bus | Manage the messaging system via messaging | Operating many components uniformly | A handful of services — dashboards suffice |
| Detour | Conditionally route via validation/debug steps | Toggleable inspection paths in prod | Permanent step — just add it to the flow |
| Wire Tap | Copy messages to inspection channel | Debugging/auditing without disturbing flow | Logging at endpoints suffices |
| Message History | Carry the list of components traversed | Tracing paths through complex topologies | Distributed tracing infra exists |
| Message Store | Persist message copies for analysis | Audit/replay/analytics requirements | Wire tap + logs cover it |
| Smart Proxy | Track request-reply through a service | Monitoring a service that fixes its reply address | Service propagates Return Address properly |
| Test Message | Inject synthetic messages to verify health | Active verification of a live flow | Passive monitoring suffices |
| Channel Purger | Remove leftover messages | Test isolation; recovering from poison backlogs | — (ops tool; keep) |
