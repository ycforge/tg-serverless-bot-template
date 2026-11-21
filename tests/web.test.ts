import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createElement, StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';

test('TMA automatically authenticates once and displays the counter without a login button', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://tma.example/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  (dom.window as any).Telegram = { WebApp: { initData: 'signed-test-data', ready() {}, expand() {} } };
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal((init?.headers as Record<string, string>).Authorization, 'tma signed-test-data');
    return new Response(JSON.stringify(String(url).endsWith('auth/telegram')
      ? { user: { id: '123', firstName: 'Тест', username: 'test' } } : { value: '42' }), { status: 200 });
  };
  const { App } = await import('../apps/web/src/App');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(App))); });
    assert.deepEqual(calls, ['/api/auth/telegram', '/api/counter']);
    assert.equal(dom.window.document.querySelector('output')?.textContent, '42');
    assert.ok(!dom.window.document.body.textContent?.includes('Войти через Telegram'));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previousFetch;
    dom.window.close();
  }
});
