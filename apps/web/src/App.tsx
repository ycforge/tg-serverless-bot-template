import React, { useEffect, useRef, useState } from 'react';

interface User { id: string; firstName: string; username: string }
interface Operation { operationId: string; delta: number }
interface TelegramApp { initData: string; ready(): void; expand(): void }
declare global { interface Window { Telegram?: { WebApp: TelegramApp } } }
const tg = window.Telegram?.WebApp;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `tma ${tg?.initData || ''}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Не удалось выполнить запрос');
  return data as T;
}

export function App() {
  const [user, setUser] = useState<User>();
  const [value, setValue] = useState('0');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Operation>();
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const pendingKey = user ? `counter-pending:${user.id}` : '';

  const autoStarted = useRef(false);
  useEffect(() => {
    tg?.ready();
    tg?.expand();
    if (tg?.initData && !autoStarted.current) {
      autoStarted.current = true;
      login();
    }
  }, []);

  async function perform(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка сети'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function login() {
    void perform(async () => {
      const session = await api<{ user: User }>('auth/telegram', {});
      const counter = await api<{ value: string }>('counter');
      let saved: Operation | undefined;
      try {
        const item = JSON.parse(localStorage.getItem(`counter-pending:${session.user.id}`) || 'null');
        if (item && typeof item.operationId === 'string' && [1, -1].includes(item.delta)) saved = item;
      } catch { /* A new login can proceed without browser storage. */ }
      setUser(session.user);
      setValue(counter.value);
      setPending(saved);
    });
  }

  function change(delta: number) {
    void perform(async () => {
      const operation = pending ?? { delta, operationId: crypto.randomUUID() };
      if (operation.delta !== delta) return;
      setPending(operation);
      try { localStorage.setItem(pendingKey, JSON.stringify(operation)); } catch { /* Optional recovery cache. */ }
      const counter = await api<{ value: string }>('counter/change', operation);
      setValue(counter.value);
      setPending(undefined);
      try { localStorage.removeItem(pendingKey); } catch { /* Optional recovery cache. */ }
      setMessage('Сохранено в YDB');
    });
  }

  function refresh() {
    void perform(async () => {
      const counter = await api<{ value: string }>('counter');
      setValue(counter.value);
    });
  }

  return <main>
    <div className="badge">TELEGRAM MINI APP</div>
    <h1>Мой счётчик</h1>
    <p className="subtitle">Маленькие шаги. Твой личный результат.</p>
    {!user ? <section className="card">
      <div className="symbol">↗</div>
      <h2>{tg?.initData ? (message && !busy ? 'Не удалось загрузить' : 'Загружаем счётчик') : 'Открой в Telegram'}</h2>
      <p>{tg?.initData
        ? 'Сейчас загрузим твоё сохранённое значение.'
        : 'Открой приложение кнопкой /start в личном чате с ботом.'}</p>
      {tg?.initData && message && !busy &&
        <button onClick={login}>Повторить загрузку</button>}
    </section> : <section className="card">
      <p className="greeting">Привет, {user.firstName || 'друг'}!</p>
      <output aria-live="polite">{value}</output>
      <p>Твоё значение хранится в облаке</p>
      <div className="controls">
        <button disabled={busy || Boolean(pending && pending.delta !== -1)} onClick={() => change(-1)}>−1</button>
        <button disabled={busy || Boolean(pending && pending.delta !== 1)} onClick={() => change(1)}>+1</button>
      </div>
      <button className="secondary" disabled={busy || Boolean(pending)} onClick={refresh}>Обновить</button>
      <small>Telegram ID: {user.id}</small>
    </section>}
    <p role="status" className="status">{busy ? 'Загрузка…' : message}</p>
    {pending && !busy && <p className="hint">Запрос мог сохраниться. Нажми {pending.delta === 1 ? '+1' : '−1'} ещё раз — повтор не изменит счётчик дважды.</p>}
  </main>;
}
