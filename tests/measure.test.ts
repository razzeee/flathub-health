import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultInterface, delta } from "../scripts/measure.ts";

test("traffic measurement uses an active default route, not Docker bridges", () => {
  assert.equal(
    defaultInterface(
      "Iface Destination Gateway Flags\ndocker0 000011AC 00000000 0001\neth0 00000000 0100000A 0003\n",
    ),
    "eth0",
  );
  assert.throws(() =>
    defaultInterface(
      "Iface Destination Gateway Flags\neth0 00000000 00000000 0000\n",
    ),
  );
});

test("resource deltas measure seconds and received bytes and reject invalid counters", () => {
  const start = { at_ms: 1000, interface: "eth0", received_bytes: 100 };
  const end = { at_ms: 2500, interface: "eth0", received_bytes: 250 };
  assert.equal(delta(start, end).elapsed_seconds, 1.5);
  assert.equal(delta(start, end).host_received_bytes, 150);
  for (const invalid of [
    { ...end, at_ms: 0 },
    { ...end, received_bytes: 99 },
    { ...end, interface: "eth1" },
    { ...end, received_bytes: NaN },
  ])
    assert.throws(() => delta(start, invalid));
});
