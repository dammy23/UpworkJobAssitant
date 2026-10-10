import { config } from '../config.js';

export interface DraftAlert {
  applierName: string;
  jobTitle: string;
  jobUrl: string;
  budget: string;
  score: number;
  reasons: string;
  draft: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function telegramConfigured(): boolean {
  return Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);
}

/** Sends a new draft to Telegram. Returns false (and logs) instead of throwing, so a failed alert never stops the pipeline. */
export async function sendDraftAlert(alert: DraftAlert): Promise<boolean> {
  if (!telegramConfigured()) return false;

  const text = [
    `<b>${escapeHtml(alert.jobTitle)}</b>`,
    `${escapeHtml(alert.applierName)} · ${escapeHtml(alert.budget)} · score <b>${alert.score}</b>`,
    alert.reasons ? `<i>${escapeHtml(alert.reasons)}</i>` : '',
    '',
    escapeHtml(alert.draft).slice(0, 3000),
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Open job on Upwork', url: alert.jobUrl },
              { text: 'Review in app', url: `${config.WEB_BASE_URL}/review` },
            ],
          ],
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[telegram] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[telegram] ${(err as Error).message}`);
    return false;
  }
}
