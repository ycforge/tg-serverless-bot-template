import { Injectable, ConflictException } from '@nestjs/common';

export const YDB_INT64_MIN = -(2n ** 63n);
export const YDB_INT64_MAX = 2n ** 63n - 1n;

export function applyCounterDelta(current: bigint, delta: bigint): bigint {
  const next = current + delta;
  if (next < YDB_INT64_MIN || next > YDB_INT64_MAX) {
    throw new ConflictException(
      `Counter value is outside the YDB Int64 range (${YDB_INT64_MIN}..${YDB_INT64_MAX})`,
    );
  }
  return next;
}

@Injectable()
export class CounterService {
  private database?: Promise<any>;

  private getDatabase(): Promise<any> {
    return this.database ??= (async () => {
      const [{ Driver }, { query }, { MetadataCredentialsProvider }] = await Promise.all([
        import('@ydbjs/core'), import('@ydbjs/query'), import('@ydbjs/auth/metadata'),
      ]);
      if (!process.env.YDB_CS) throw new Error('YDB_CS is not configured');
      const driver = new Driver(process.env.YDB_CS, { credentialsProvider: new MetadataCredentialsProvider() });
      await driver.ready();
      return query(driver);
    })().catch((error) => { this.database = undefined; throw error; });
  }

  async read(userId: string) {
    const sql = await this.getDatabase();
    const [rows] = await sql`SELECT value FROM tg_example_counters WHERE user_id = ${userId}`;
    return { value: BigInt(rows[0]?.value ?? 0).toString() };
  }

  async change(userId: string, operationId: string, delta: number) {
    const sql = await this.getDatabase();
    return sql.begin({ isolation: 'serializableReadWrite', idempotent: true }, async (tx: any) => {
      const [operations] = await tx`SELECT delta FROM tg_example_operations WHERE user_id = ${userId} AND operation_id = ${operationId}`;
      const [rows] = await tx`SELECT value FROM tg_example_counters WHERE user_id = ${userId}`;
      const current = BigInt(rows[0]?.value ?? 0);
      if (operations.length) {
        if (BigInt(operations[0].delta) !== BigInt(delta)) throw new ConflictException('Operation ID conflict');
        return { value: current.toString() };
      }
      const next = applyCounterDelta(current, BigInt(delta));
      await tx`UPSERT INTO tg_example_counters (user_id, value) VALUES (${userId}, ${next})`;
      await tx`UPSERT INTO tg_example_operations (user_id, operation_id, delta) VALUES (${userId}, ${operationId}, ${BigInt(delta)})`;
      return { value: next.toString() };
    });
  }
}
