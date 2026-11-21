import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import {
  YDB_INT64_MAX,
  YDB_INT64_MIN,
  applyCounterDelta,
} from '../apps/api/src/counters';

test('counter accepts values beyond the removed ±1e9 cap', () => {
  assert.equal(applyCounterDelta(1_000_000_000n, 1n), 1_000_000_001n);
  assert.equal(applyCounterDelta(-1_000_000_000n, -1n), -1_000_000_001n);
});

test('counter can reach both natural YDB Int64 boundaries', () => {
  assert.equal(applyCounterDelta(YDB_INT64_MAX - 1n, 1n), YDB_INT64_MAX);
  assert.equal(applyCounterDelta(YDB_INT64_MIN + 1n, -1n), YDB_INT64_MIN);
});

test('counter reports a clear conflict instead of overflowing YDB Int64', () => {
  for (const [current, delta] of [
    [YDB_INT64_MAX, 1n],
    [YDB_INT64_MIN, -1n],
  ] as const) {
    assert.throws(
      () => applyCounterDelta(current, delta),
      (error: unknown) => error instanceof ConflictException && /YDB Int64/.test(error.message),
    );
  }
});

test('counter service persists a value beyond the former cap in its transaction', async () => {
  const { CounterService } = await import('../apps/api/src/counters');
  const service = new CounterService();
  const writes: unknown[][] = [];
  const tx = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join('?');
    if (text.includes('SELECT delta')) return [[]];
    if (text.includes('SELECT value')) return [[{ value: 1_000_000_000n }]];
    writes.push(values);
    return [];
  };
  Object.defineProperty(service, 'database', {
    value: Promise.resolve({
      begin: async (options: { isolation: string; idempotent: boolean }, work: (query: typeof tx) => unknown) => {
        assert.equal(options.isolation, 'serializableReadWrite');
        assert.equal(options.idempotent, true);
        return work(tx);
      },
    }),
  });
  assert.deepEqual(await service.change('123', 'operation-id', 1), { value: '1000000001' });
  assert.deepEqual(writes, [['123', 1_000_000_001n], ['123', 'operation-id', 1n]]);
});
