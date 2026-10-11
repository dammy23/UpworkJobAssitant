import { config } from '../config.js';
import { getTelegram } from '../services/settings.js';

export interface DraftAlert {
  accountName: string;
  applierName: string;
  jobTitle: string;
  jobUrl: string;
  budget: string;
  score: number;
  reasons: string;
  draft: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method: string, body: Record<string, unknown>, token: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
  if (!res.ok || !json.ok) throw new Error(json.description ?? `Telegram replied ${res.status}`);
  return json.result;
}

export async function sendTelegramMessage(text: string, extra: Record<string, unknown> = {}): Promise<void> {
  const t = await getTelegram();
  if (!t.botToken || !t.chatId) throw new Error('Telegram is not set up');
  await call('sendMessage', { chat_id: t.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }, t.botToken);
}

/** Finds the chat of the most recent message sent to the bot, so the user doesn't have to look up their chat id. */
export async function findLatestChatId(botToken: string): Promise<string | null> {
  const updates = (await call('getUpdates', { limit: 20 }, botToken)) as { message?: { chat?: { id: number } } }[];
  const last = [...updates].reverse().find((u) => u.message?.chat?.id != null);
  return last?.message?.chat?.id != null ? String(last.message.chat.id) : null;
}

/** Sends a new draft to Telegram. Returns false (and logs) instead of throwing, so a failed alert never stops the pipeline. */
export async function sendDraftAlert(alert: DraftAlert): Promise<boolean> {
  const t = await getTelegram();
  if (!t.botToken || !t.chatId) return false;

  const text = [
    `<b>${escapeHtml(alert.jobTitle)}</b>`,
    `${escapeHtml(alert.accountName)}, ${escapeHtml(alert.applierName)} applier. ${escapeHtml(alert.budget)}. Fit <b>${alert.score}</b>`,
    alert.reasons ? `<i>${escapeHtml(alert.reasons.replace(/\n/g, ' '))}</i>` : '',
    '',
    escapeHtml(alert.draft).slice(0, 3000),
  ].join('\n');

  try {
    await sendTelegramMessage(text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Open job on Upwork', url: alert.jobUrl },
            { text: 'Review in the app', url: `${config.WEB_BASE_URL}/review` },
          ],
        ],
      },
    });
    return true;
  } catch (err) {
    console.warn(`[telegram] ${(err as Error).message}`);
    return false;
  }
}
