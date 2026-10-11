import cron from 'node-cron';
import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { runDueAppliers } from './pipeline/run.js';
import { startTelegramListener } from './pipeline/notify.js';
import { ensureProviders } from './services/providers.js';
import { handleTelegramTap, processQueue, recoverInterruptedSends } from './services/sending.js';

await runMigrations();
await ensureProviders();
await recoverInterruptedSends();

const app = await buildApp({ logger: false });
await app.listen({ port: config.PORT, host: config.HOST });
console.log(`Job Assistant API on http://localhost:${config.PORT}`);

if (config.SCHEDULER === 'on') {
  let busy = false;
  // Every minute, run the appliers whose schedule is due. Runs never overlap.
  cron.schedule('* * * * *', async () => {
    if (busy) return;
    busy = true;
    try {
      const results = await runDueAppliers();
      for (const r of results) {
        console.log(
          `[run] ${r.applierName}: ${r.fetched} fetched, ${r.filtered} filtered, ${r.belowThreshold} below threshold, ${r.drafted} drafted` +
            (r.errors.length ? `, ${r.errors.length} error(s): ${r.errors[0]}` : ''),
        );
      }
    } catch (err) {
      console.error('[run] scheduler error', err);
    } finally {
      busy = false;
    }
  });
  console.log('Scheduler on: due appliers are checked every minute.');
}

// Approved proposals are sent one at a time per account, within each account's limits.
let stopQueue = () => {};
if (config.SEND_QUEUE === 'on') {
  const timer = setInterval(() => {
    processQueue().catch((err) => console.error('[send] queue error', err));
  }, 15_000);
  stopQueue = () => clearInterval(timer);
  console.log('Send queue on: approved proposals are sent within each account\'s limits.');
}

// Submit / Skip taps from Telegram.
const stopTelegram = startTelegramListener(handleTelegramTap);

const shutdown = async () => {
  stopQueue();
  stopTelegram();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
