# TypeScript orchestration: dependency decision

Research checked **2026-10-19**. **Recommendation: migrate the local scripts to
TypeScript on Node.js 24 without Effect initially.** Keep one tested process
adapter and explicit boundary validation; reconsider Effect if orchestration
becomes substantially concurrent or its typed error/resource model becomes a
team-wide convention. The migration follows this recommendation; Python remains
only in the upstream action wrapper. A follow-up adds Zod for runtime boundary
validation and inferred types, plus Prettier as a development-only formatter.
Neither requires adopting an effect runtime or replacing the process adapter.

## Actual scope

- [`catalog.ts`](../scripts/catalog.ts) validates three catalog entries and emits
  an Actions matrix. Validation includes unknown-field rejection, uniqueness,
  explicit refs, and existing recipe paths beneath `recipes/`.
- [`run.ts`](../scripts/run.ts) performs sequential, bounded Git/Docker/Flatpak
  commands, pins source/image provenance, exports a bundle, and invokes the
  **upstream Python** `action/run.py`. Migrating our wrapper does not remove that
  Python requirement or justify reimplementing upstream desktop automation.
- [`report.ts`](../scripts/report.ts) aggregates JSON artifacts and renders
  Markdown, treating missing/invalid evidence as incomplete.
- [README](../README.md) delegates app parallelism to Actions (maximum two jobs),
  with three bootstrap apps and no current retry/history/notification service.
  [Tests](../tests/health.test.ts) cover validation, classification, timeout/exit,
  phase independence, provenance, missing artifacts, process-tree cleanup, and
  external cancellation. The latter coverage was added during the migration.

## Released versions, not beta advice

The npm registry's `latest` is **`effect@4.0.5`**, published
2026-10-15; `prev` is `3.22.3`, while beta/RC are separate tags. Therefore advice
that “Effect 4 is only an unreleased beta” is stale at this research date.
`@effect/platform-node` is also `4.0.5`. Core `effect` has no runtime dependencies;
the Node adapter adds `@effect/platform-node-shared` and `undici`, with further
transitives. A zero-dependency core is not a zero-dependency process stack.
[Registry: core][registry] · [Node adapter][node-package] · [shared adapter][shared-package]

Importantly, a stable **package release** does not make every API stable:
4.0.5's `effect/process/ChildProcess` and `NodeChildProcessSpawner` are explicitly
marked **unstable** in the released source. Do not adopt prereleases or copy
older v3 `Command` examples as the current v4 interface. [Command source][command]
· [Node spawner source][spawner]

## Node.js 24 versus Effect

| Concern                     | Node.js 24 built-ins                                                                                                                                                                                                                       | What Effect adds / costs here                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processes and logs          | `node:child_process.spawn` supports argv without a shell, environment, streamed/file stdio, exit signals and `close`. Use bounded capture only for short metadata commands; drain output to avoid pipe deadlock. [Node docs][node-process] | Scoped process handles, streams and platform errors via the Node spawner; useful, but additional services/layers and currently unstable process APIs. [Spawner][spawner]                                                                                                                                                    |
| Timeouts and cleanup        | `timeout`/`signal` send a kill signal; they do not supply a complete TERM → grace → KILL tree supervisor. Explicit cleanup belongs in the adapter and `finally`. [Node docs][node-process]                                                 | `Effect.timeout` interrupts the effect; scoped finalizers run on scope closure. The Node spawner handles POSIX groups and configurable `forceKillAfter`; escalation is **not enabled by default**. [Core API][core] · [Spawner][spawner]                                                                                    |
| Typed failures              | `Promise<T>` does not encode rejection types. A small discriminated result union can explicitly represent spawn failure, timeout, exit failure and invalid evidence.                                                                       | `Effect<Success, Error, Requirements>` composes expected errors and required services through signatures. This is a genuine benefit, but requires adopting its execution/error model, not merely importing a timeout helper. [Effect type][effect-type]                                                                     |
| Runtime schemas             | JSON parsing and TypeScript types alone are insufficient; use tested validators accepting `unknown` for catalog, runner config, upstream results and artifacts.                                                                            | `effect/Schema` provides decoding, validation and inferred types, including synchronous use without converting all orchestration to Effect. Filesystem containment, uniqueness and provenance checks still need explicit domain checks. Schema alone is not enough reason to adopt the whole runtime. [Schema docs][schema] |
| Concurrency and maintenance | Existing per-app sequencing plus Actions job limits need no in-process scheduler. Ordinary async functions and `node:test` keep the migration small. [Node tests][node-test]                                                               | Bounded concurrency, fibers, scopes, services/layers and typed errors compose well as complexity grows; those concepts also become contributor prerequisites. [Concurrency][concurrency] · [Onboarding][onboarding]                                                                                                         |

### Cancellation is not process-tree termination

`Promise.race` with a timer only stops **waiting**; it does not cancel the losing
operation. Likewise, wrapping a subprocess promise in `Effect.tryPromise` does
not magically stop it: the underlying operation must observe its supplied
`AbortSignal`. [Released API][core]

Node abort/kill targets the child; its docs explicitly warn that Linux descendants
can survive. A Linux process group can cover descendants that stay in that group,
not processes that deliberately escape it. Effect's Node spawner adds group
signalling and scoped cleanup, not a guarantee that every descendant is gone.
Neither killing the Docker CLI nor interrupting an Effect proves removal of a
daemon-managed container. [Node kill docs][node-kill] · [Spawner][spawner]

Preserve the upstream wrapper's TERM cleanup opportunity and the current outer
GNU `timeout --kill-after=30s` policy unless replacing it with tested equivalent
supervision. Test grandchildren, TERM-resistant children, spawn failure, partial
logs and external cancellation; ensure cleanup finishes before declaring the
operation complete. Keep container cleanup upstream and preserve per-phase
artifact writing and “recipe still runs after startup failure.” No finalizer can
guarantee completion after SIGKILL or VM loss.

## Decision for the migration

Start with Node 24 built-ins (`child_process`, `fs`, `path`, `util`,
`node:test`) and normal TypeScript development tooling. Do not add Effect just to
replace three short scripts. Validation is isolated in `scripts/model.ts` using
Zod schemas; types are inferred rather than asserted from untrusted JSON.
Prettier formats maintained TypeScript, JSON, YAML, and Markdown, with a CI check.
Retain Python for the pinned upstream
action, failure classifications, provenance and artifact formats.

Revisit Effect when there are multiple interacting resource lifetimes,
in-process bounded app execution, retry policies or service dependencies that
make manual composition demonstrably repetitive. If chosen then, verify current
stable metadata and test the released Node adapter's cleanup semantics rather
than relying on generic claims about structured concurrency.

[registry]: https://registry.npmjs.org/effect
[node-package]: https://registry.npmjs.org/@effect/platform-node/4.0.5
[shared-package]: https://registry.npmjs.org/@effect/platform-node-shared/4.0.5
[command]: https://github.com/Effect-TS/effect/blob/effect%404.0.5/packages/effect/src/process/ChildProcess.ts
[spawner]: https://github.com/Effect-TS/effect/blob/effect%404.0.5/packages/platform/node-shared/src/NodeChildProcessSpawner.ts
[core]: https://github.com/Effect-TS/effect/blob/effect%404.0.5/packages/effect/src/Effect.ts
[effect-type]: https://effect.website/docs/v4/getting-started/the-effect-type
[schema]: https://effect.website/docs/v4/schema/introduction
[concurrency]: https://effect.website/docs/v4/concurrency/basic-concurrency
[onboarding]: https://effect.website/docs/v4/
[node-process]: https://nodejs.org/docs/latest-v24.x/api/child_process.html
[node-kill]: https://nodejs.org/docs/latest-v24.x/api/child_process.html#subprocesskillsignal
[node-test]: https://nodejs.org/docs/latest-v24.x/api/test.html
