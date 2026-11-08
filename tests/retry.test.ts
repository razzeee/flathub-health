import assert from "node:assert/strict";
import { test } from "node:test";
import type { Outcome } from "../scripts/model.ts";
import { outcomeSchema } from "../scripts/model.ts";
import { retryPhase } from "../scripts/retry.ts";
import { CommandError } from "../scripts/process.ts";
import { attemptState } from "../scripts/attempts.ts";

test("attempt states distinguish first passes, retry results and unrecorded history", () => {
  const passed: Outcome = { status: "passed" };
  const failed: Outcome = { status: "infrastructure_failed" };
  assert.equal(attemptState(passed), undefined);
  assert.equal(attemptState(failed), undefined);
  assert.equal(attemptState({ ...passed, attempts: [passed] }), "first_pass");
  assert.equal(attemptState({ ...failed, attempts: [failed] }), undefined);
  assert.equal(
    attemptState({ ...passed, attempts: [failed, passed] }),
    "retry_recovered",
  );
  for (const status of [
    "infrastructure_failed",
    "app_failed",
    "recipe_failed",
  ] as const) {
    const final = { status };
    assert.equal(
      attemptState({ ...final, attempts: [failed, final] }),
      "retry_failed",
    );
  }
});

function transient(): Outcome {
  return {
    status: "infrastructure_failed",
    exit_code: 1,
    reason: "fixture_transient",
    category: "infrastructure",
    execution: {
      schema_version: 1,
      status: "completed",
      exit_code: 1,
      cleanup: { remove: { status: "ok" } },
    },
    metadata: {
      app: { ref: "app/org.example.Demo/x86_64/stable", commit: "abc" },
      runtimes: [{ ref: "runtime/example", commit: "def" }],
      recipe: null,
      runner_image: { version: "v0.5.1", image: "example", digest: null },
    },
  };
}

test("production policy never retries an unproven failure", async () => {
  let calls = 0;
  const result = await retryPhase(
    async () => {
      calls++;
      return transient();
    },
    () => {},
  );
  assert.equal(calls, 1);
  assert.equal(result.attempts?.length, 1);
});

test("one retry retains both attempts and saves the failure before retrying", async () => {
  const saved: Outcome[] = [];
  const failed = transient();
  const passed: Outcome = { status: "passed", metadata: failed.metadata };
  const result = await retryPhase(
    async (attempt) => {
      if (attempt === 1) return failed;
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0]?.attempts, [failed]);
      return passed;
    },
    (outcome) => saved.push(structuredClone(outcome)),
    () => true,
  );
  assert.equal(result.status, "passed");
  assert.deepEqual(result.attempts, [failed, passed]);
  assert.equal(saved.length, 2);
  assert.equal(outcomeSchema.safeParse(result).success, true);
});

test("persistent failures stop after two attempts even when still eligible", async () => {
  let calls = 0;
  const result = await retryPhase(
    async () => {
      calls++;
      return transient();
    },
    () => {},
    () => true,
  );
  assert.equal(calls, 2);
  assert.equal(result.status, "infrastructure_failed");
  assert.equal(result.attempts?.length, 2);
});

test("app, recipe, unknown and unsafe wrapper failures cannot be retried", async () => {
  const failed = transient();
  for (const outcome of [
    { ...failed, status: "passed" },
    { ...failed, status: "app_failed" },
    { ...failed, status: "recipe_failed" },
    { ...failed, reason: undefined },
    { ...failed, category: "expectation" },
    { ...failed, category: undefined },
    { ...failed, exit_code: null },
    { ...failed, execution: undefined },
    { ...failed, execution: { ...failed.execution!, status: "timed_out" } },
    { ...failed, execution: { ...failed.execution!, signal: "SIGTERM" } },
    { ...failed, execution: { ...failed.execution!, cleanup: null } },
    {
      ...failed,
      execution: {
        ...failed.execution!,
        cleanup: { remove: { status: "failed" } },
      },
    },
  ] satisfies Outcome[]) {
    let calls = 0;
    await retryPhase(
      async () => {
        calls++;
        return outcome;
      },
      () => {},
      () => true,
    );
    assert.equal(calls, 1, JSON.stringify(outcome));
  }
});

test("exceptions are retained without retry and cancellation stops the run", async () => {
  const saved: Outcome[] = [];
  let calls = 0;
  const run = async () => {
    calls++;
    throw new Error("missing runner");
  };
  const result = await retryPhase(
    run,
    (outcome) => saved.push(outcome),
    () => true,
  );
  assert.equal(calls, 1);
  assert.equal(result.attempts?.[0]?.message, "missing runner");
  const cancelled = new CommandError("cancelled", true);
  await assert.rejects(
    retryPhase(
      async () => {
        throw cancelled;
      },
      (outcome) => saved.push(outcome),
    ),
    (error) => error === cancelled,
  );
  assert.equal(saved.at(-1)?.status, "infrastructure_failed");
});

test("attempt schema rejects over-limit and inconsistent final outcomes", () => {
  const failed = transient();
  for (const attempts of [
    [],
    [failed, failed, failed],
    [{ ...failed, attempts: [failed] }],
  ]) {
    assert.equal(
      outcomeSchema.safeParse({ ...failed, attempts }).success,
      false,
    );
  }
  assert.equal(
    outcomeSchema.safeParse({ status: "passed", attempts: [failed] }).success,
    false,
  );
});
