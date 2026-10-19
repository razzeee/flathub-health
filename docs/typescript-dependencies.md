# TypeScript dependencies

Checked on 2026-10-19. We use Node.js 24 without Effect. Zod validates JSON and
supplies inferred types. Prettier formats maintained files. Python remains a
requirement of the pinned upstream action wrapper.

## What these scripts do

- [`catalog.ts`](../scripts/catalog.ts) validates app entries and emits an Actions
  matrix. It rejects unknown fields and duplicate IDs, checks refs, and requires
  recipe files to stay under `recipes/`.
- [`run.ts`](../scripts/run.ts) runs Git, Docker, and Flatpak commands in sequence.
  It records source and image versions, exports a bundle, and calls the upstream
  Python `action/run.py`. It does not replace upstream desktop automation.
- [`report.ts`](../scripts/report.ts) reads JSON artifacts and writes Markdown.
  Missing or invalid results count as incomplete.

Actions limits app jobs to two at a time. The scripts do not manage concurrent
app runs, retries, history, or notifications. The [tests](../tests/health.test.ts)
cover validation, failure classification, timeouts, phase independence,
version metadata, missing artifacts, process-group cleanup, and cancellation.

## Effect release and API status

At the check date, the npm registry's `latest` tag points to `effect@4.0.5`,
published on 2026-10-15. The `prev` tag points to `3.22.3`. Beta and RC releases
have separate tags. `@effect/platform-node` is also `4.0.5`.
[Core registry metadata][registry], [Node adapter metadata][node-package].

Core `effect` has no runtime dependencies. The Node adapter adds
`@effect/platform-node-shared` and `undici`, plus their dependencies.
[Shared adapter metadata][shared-package].

The 4.0.5 source marks `effect/process/ChildProcess` and
`NodeChildProcessSpawner` as unstable, despite the stable package release.
Older v3 `Command` examples use a different interface.
[ChildProcess source][command], [Node spawner source][spawner].

## What Effect would change

### Process handling

Node's `spawn` accepts argument arrays, environments, and file or pipe output.
The process adapter must drain pipes, bound captured output, and handle exit
signals. [Node process docs][node-process].

Effect's Node spawner adds process handles tied to scopes, output streams, and
platform errors. Its POSIX process-group handling includes a configurable
`forceKillAfter` limit. It does not enable that escalation by default.
[Node spawner source][spawner].

### Error types and validation

`Promise<T>` does not describe rejection types. Effect's
`Effect<Success, Error, Requirements>` includes expected errors and required
services in its type. Using it throughout these scripts would change how we
write and run them. [Effect type docs][effect-type].

`effect/Schema` can validate JSON and infer types without converting all code to
Effect. Zod now does that here. Neither library replaces checks for path
containment, duplicate IDs, or required version metadata. [Schema docs][schema].

### Concurrency and maintenance

Effect offers bounded concurrency, fibers, scopes, and services. Those tools
would help with concurrent local app runs or interacting resources. They also
require contributors to learn Effect's execution model. For the current
sequential commands, async functions and `node:test` are enough.
[Concurrency docs][concurrency], [Effect introduction][onboarding],
[Node test docs][node-test].

## Cancellation and process cleanup

`Promise.race` with a timer stops waiting. It does not stop the subprocess.
Wrapping a promise in `Effect.tryPromise` does not stop it either unless the
operation handles its supplied `AbortSignal`. [Released API][core].

Node's abort and kill methods target the child process. Linux descendants can
survive. Process-group signals reach descendants that stay in that group, but
not those that leave it. Effect's spawner handles groups and scope cleanup,
but cannot guarantee that every descendant exits.
[Node kill docs][node-kill], [Node spawner source][spawner].

Docker containers need separate cleanup. Killing the Docker CLI does not prove
that the daemon removed its container. Keep the upstream wrapper's TERM handler
and the outer `timeout --kill-after=30s` policy unless tests prove a replacement
works. Tests must cover grandchildren, TERM-resistant processes, spawn errors,
partial logs, and external cancellation. No cleanup handler can finish after
SIGKILL or VM loss.

## Decision

Keep Node's built-in process handling and test runner. Use Zod schemas in
`scripts/model.ts` instead of asserting types for untrusted JSON. Use Prettier
with a CI format check. Retain Python for the upstream action and keep its
artifact format and failure classifications.

Reconsider Effect if concurrent local app runs, retry policies, or shared
resources make manual error handling and cleanup repetitive. Before adopting
it, check the released Node adapter's behavior and test its cleanup semantics.

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
