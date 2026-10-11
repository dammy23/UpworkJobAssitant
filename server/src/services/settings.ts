import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import { decrypt, encrypt, hint } from '../lib/crypto.js';

export async function getSetting(key: string): Promise<string | undefined> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value;
}

export async function putSetting(key: string, value: string | null): Promise<void> {
  if (value === null || value === '') {
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return;
  }
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export interface TelegramSettings {
  botToken: string | undefined;
  chatId: string | undefined;
}

export async function getTelegram(): Promise<TelegramSettings> {
  const enc = await getSetting('telegram.botToken');
  return { botToken: enc ? decrypt(enc) : undefined, chatId: await getSetting('telegram.chatId') };
}

export async function setTelegram(input: { botToken?: string; chatId?: string }): Promise<void> {
  if (input.botToken !== undefined) {
    const before = await getSetting('telegram.botToken');
    await putSetting('telegram.botToken', input.botToken.trim() ? encrypt(input.botToken.trim()) : null);
    // A different bot starts its update stream from scratch.
    if (before !== undefined) {
      await putSetting('telegram.offset', null);
      await putSetting('telegram.lastChatId', null);
    }
  }
  if (input.chatId !== undefined) await putSetting('telegram.chatId', input.chatId.trim() || null);
}

export async function telegramView() {
  const t = await getTelegram();
  return { configured: Boolean(t.botToken && t.chatId), tokenHint: hint(t.botToken), chatId: t.chatId ?? null };
}
