type Update = { message?: { text?: string; chat: { id: number; type: string } } };

async function sendMessage(payload: Record<string, unknown>) {
  const token = process.env.BOT_TOKEN;
  const proxy = process.env.TG_PROXY_BASE?.replace(/\/+$/, '');
  if (!token || !proxy) throw new Error('Missing BOT_TOKEN or TG_PROXY_BASE');
  let response: Response;
  let result: { ok?: boolean; error_code?: number };
  try {
    response = await fetch(`${proxy}${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
    });
    result = await response.json() as typeof result;
  } catch {
    throw new Error('Telegram proxy request failed');
  }
  if (!response.ok || !result.ok) throw new Error(`Telegram API error: ${result.error_code ?? response.status}`);
}

export async function handler(event: Update) {
  const message = event?.message;
  if (typeof message?.text !== 'string') return { ok: true };
  const command = message.text.trim().split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase();
  if (command === 'ping' || command === '/ping') {
    await sendMessage({ chat_id: message.chat.id, text: 'pong' });
  } else if (command === '/start') {
    if (message.chat.type !== 'private') {
      await sendMessage({ chat_id: message.chat.id, text: 'Открой личный чат со мной и отправь /start.' });
    } else {
      const url = process.env.TMA_URL;
      if (!url || new URL(url).protocol !== 'https:') throw new Error('Invalid TMA_URL');
      await sendMessage({
        chat_id: message.chat.id, text: 'Открой приложение — внутри твой личный счётчик.',
        reply_markup: { inline_keyboard: [[{ text: 'Открыть счётчик', web_app: { url } }]] },
      });
    }
  }
  return { ok: true };
}
