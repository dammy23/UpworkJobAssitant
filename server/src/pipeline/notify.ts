import { config } from '../config.js';
import { getTelegram, getSetting, putSetting } from '../services/settings.js';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call<T = unknown>(token: string, method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(`${config.TELEGRAM_API_URL}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
  if (!res.ok || !json.ok) throw new Error(json.description ?? `Telegram replied ${res.status}`);
  return json.result as T;
}

/** Telegram refuses link buttons that point at localhost or private addresses. */
function publicAppUrl(path: string): string | null {
  try {
    const u = new URL(path, config.WEB_BASE_URL);
    if (/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(u.hostname) || u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function sendTelegramMessage(text: string, extra: Record<string, unknown> = {}): Promise<number> {
  const t = await getTelegram();
  if (!t.botToken || !t.chatId) throw new Error('Telegram is not set up');
  const msg = await call<{ message_id: number }>(t.botToken, 'sendMessage', {
    chat_id: t.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
  return msg.message_id;
}

export interface DraftAlert {
  matchId: string;
  accountName: string;
  applierName: string;
  jobTitle: string;
  jobUrl: string;
  budget: string;
  score: number;
  reasons: string;
  draft: string;
  bid: string | null;
  duration: string | null;
  questions: number;
  unanswered: number;
  connects: number | null;
}

function alertText(a: DraftAlert, status?: string): string {
  const facts = [a.bid && `Bid ${a.bid}`, a.duration, a.connects != null && `${a.connects} Connects`].filter(Boolean).join(' · ');
  const lines = [
    `<b>${escapeHtml(a.jobTitle)}</b>`,
    `${escapeHtml(a.accountName)}'s account, ${escapeHtml(a.applierName)} applier. ${escapeHtml(a.budget)}. Fit <b>${a.score}</b>`,
    a.reasons ? `<i>${escapeHtml(a.reasons.replace(/\n/g, ' '))}</i>` : '',
    '',
    escapeHtml(a.draft).slice(0, 2500),
    '',
    facts ? escapeHtml(facts) : '',
    a.questions ? (a.unanswered ? `${a.unanswered} of ${a.questions} screening answers still to write in the app.` : `${a.questions} screening answers drafted.`) : '',
  ];
  const editUrl = publicAppUrl(`/review?draft=${a.matchId}`);
  if (!editUrl) lines.push(`Edit: ${escapeHtml(new URL(`/review?draft=${a.matchId}`, config.WEB_BASE_URL).toString())}`);
  if (status) lines.push('', `<b>${escapeHtml(status)}</b>`);
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

function alertButtons(a: DraftAlert) {
  const editUrl = publicAppUrl(`/review?draft=${a.matchId}`);
  return {
    inline_keyboard: [
      [
        { text: 'Submit', callback_data: `sub:${a.matchId}` },
        { text: 'Skip', callback_data: `skip:${a.matchId}` },
      ],
      [{ text: 'Open job', url: a.jobUrl }, ...(editUrl ? [{ text: 'Edit in app', url: editUrl }] : [])],
    ],
  };
}

/** Sends a new draft with Submit / Skip buttons. Returns the message id, or null if Telegram isn't set up or failed. */
export async function sendDraftAlert(alert: DraftAlert): Promise<number | null> {
  const t = await getTelegram();
  if (!t.botToken || !t.chatId) return null;
  try {
    return await sendTelegramMessage(alertText(alert), { reply_markup: alertButtons(alert) });
  } catch (err) {
    console.warn(`[telegram] ${(err as Error).message}`);
    return null;
  }
}

/** Rewrites a draft alert with a status line and removes (or keeps) its buttons. */
export async function updateDraftAlert(messageId: number, alert: DraftAlert, status: string, keepButtons = false): Promise<void> {
  const t = await getTelegram();
  if (!t.botToken || !t.chatId) return;
  try {
    await call(t.botToken, 'editMessageText', {
      chat_id: t.chatId,
      message_id: messageId,
      text: alertText(alert, status),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: keepButtons ? alertButtons(alert) : { inline_keyboard: [] },
    });
  } catch (err) {
    // "message is not modified" and deleted messages are harmless.
    console.warn(`[telegram] couldn't update message ${messageId}: ${(err as Error).message}`);
  }
}

// ---- Listening for taps ----

export type TapHandler = (action: 'sub' | 'skip', matchId: string) => Promise<{ toast: string; status?: string }>;

interface Update {
  update_id: number;
  message?: { chat: { id: number } };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
}

let polling = false;

/**
 * Long-polls Telegram for button taps and messages. Only taps from the configured chat are acted on.
 * Also remembers the last chat that messaged the bot, for "Find my chat".
 */
export function startTelegramListener(onTap: TapHandler): () => void {
  let stopped = false;
  polling = true;
  const loop = async () => {
    while (!stopped) {
      const t = await getTelegram().catch(() => ({ botToken: undefined, chatId: undefined }));
      if (!t.botToken) {
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      try {
        const offset = Number((await getSetting('telegram.offset')) ?? 0);
        const updates = await call<Update[]>(
          t.botToken,
          'getUpdates',
          { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
          35_000,
        );
        for (const u of updates) {
          await putSetting('telegram.offset', String(u.update_id + 1));
          if (u.message?.chat?.id != null) await putSetting('telegram.lastChatId', String(u.message.chat.id));
          const cq = u.callback_query;
          if (!cq?.data) continue;
          const fromChat = cq.message?.chat?.id != null ? String(cq.message.chat.id) : null;
          if (!t.chatId || fromChat !== t.chatId) {
            await call(t.botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'This chat is not linked to Job Assistant.' }).catch(() => {});
            continue;
          }
          const [action, matchId] = cq.data.split(':');
          let toast = 'Done';
          try {
            if (action === 'sub' || action === 'skip') toast = (await onTap(action, matchId)).toast;
          } catch (err) {
            toast = (err as Error).message;
          }
          await call(t.botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: toast.slice(0, 190), show_alert: toast.length > 60 }).catch(() => {});
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (!/aborted|timeout/i.test(msg)) console.warn(`[telegram] listener: ${msg}`);
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
    polling = false;
  };
}

export const telegramListening = () => polling;

/** The chat that most recently messaged the bot (seen by the listener). */
export async function findLatestChatId(): Promise<string | null> {
  return (await getSetting('telegram.lastChatId')) ?? null;
}
