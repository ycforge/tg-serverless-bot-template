import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../apps/bot/src/index';

test('bot /start sends a Mini App button and ping still returns pong', async () => {
  const previousFetch = globalThis.fetch;
  const sent: Array<Record<string, any>> = [];
  process.env.BOT_TOKEN = 'local-test-token';
  process.env.TG_PROXY_BASE = 'https://proxy.example/bot';
  process.env.TMA_URL = 'https://tma.example/';
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://proxy.example/botlocal-test-token/sendMessage');
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await handler({ message: { text: '/start', chat: { id: 123, type: 'private' } } });
    assert.equal(sent[0].reply_markup.inline_keyboard[0][0].web_app.url, 'https://tma.example/');
    await handler({ message: { text: '/ping@ExampleBot', chat: { id: 123, type: 'private' } } });
    assert.equal(sent[1].text, 'pong');
    await handler({ message: { text: 'irrelevant', chat: { id: 123, type: 'private' } } });
    assert.equal(sent.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
