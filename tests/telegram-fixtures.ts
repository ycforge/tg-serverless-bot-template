import { createHmac } from 'node:crypto';

export const token = 'test-bot-token';
export const now = 1800000000;

export const signedUser = { id: 123456789, first_name: 'Тест', username: 'tester' };

export function fields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(now),
    user: JSON.stringify(signedUser),
    signature: 'additional-telegram-signature',
    ...overrides,
  };
}

export function liveFields(overrides: Record<string, string> = {}): Record<string, string> {
  return fields({ auth_date: String(Math.floor(Date.now() / 1000)), ...overrides });
}

export function signed(entries: Record<string, string>, signingToken = token): string {
  const params = new URLSearchParams(entries);
  const text = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(signingToken).digest();
  params.set('hash', createHmac('sha256', key).update(text).digest('hex'));
  return params.toString();
}
