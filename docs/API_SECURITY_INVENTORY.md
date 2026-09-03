# API security inventory

`lib/security/api-route-policy.ts` is the checked inventory. CI discovers every
`app/api/**/route.ts` file and fails when a route is unclassified or no longer
contains the marker for its declared boundary.

| Boundary | Current rule |
| --- | --- |
| Authenticated tenant | The route resolves PostgreSQL authority through `requireWorkspaceContext`; organization/project lookups remain composite scoped. |
| Signed webhook | The route verifies the provider signature over the expected body before dispatch and uses idempotent PostgreSQL delivery state. |
| Bounded public | The route validates bounded input and reserves abuse/cost capacity before provider, storage, or notification work. |
| Legacy quarantined | The route remains addressable for migration history but returns `410 Gone` unless a deliberate server-only override is enabled. If temporarily enabled, unexpected failures use one generic, content-free responder with a request ID and `no-store`; caught provider errors are neither logged nor returned. |

Classification is necessary but not sufficient. Unit/integration tests retain
negative tenant, signature, replay, input, limit, and quarantine behavior. A
new API route cannot merge until both the inventory entry and the applicable
behavior tests exist.
