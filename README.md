# Upwork Job Assistant

Finds Upwork jobs for each of your **appliers**, filters and scores them with AI, and drafts a proposal for the good ones. You read each draft, edit it and submit it yourself on Upwork, then mark it applied so you can track replies, interviews and hires.

**It never submits anything for you.** Upwork's terms forbid bots that submit proposals, so the app only searches jobs and writes drafts.

## What it does

- **Appliers for any kind of work**: virtual assistant, writer, bookkeeper, customer support, designer, translator, developer, or your own. Each has its role titles, skills, words to avoid, pay and client rules, resume, intro video, past work and tone of voice.
- **Several Upwork accounts**: each applier belongs to one account (for example yours and a teammate's). Upwork allows one freelancer account per person.
- **Your choice of AI**: Groq (free tier), Claude, OpenAI or Ollama on your own computer, set up in Settings, with a default order and automatic fallback. Each applier can pick its own.
- **Review screen**: the job post beside the reply, a fit score with reasons and concerns, one-click rewrites (new version, shorter, warmer, more specific), and "Copy reply and open job".
- **Applied jobs**: every proposal you sent, its status, notes and Connects spent, with CSV export.
- **Telegram alerts** for new drafts (optional).
- **Sample jobs** until Upwork approves an account's API key, so everything can be tried straight away. With no AI provider set up, a simple offline scorer is used.

## Run it

You need Node.js 20+ and Docker (for Postgres).

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run build        # builds the web app
npm start            # API + web app on http://localhost:4000
```

The server applies database migrations on start. Optional: `npm run db:seed` adds a demo account with two appliers.

Then open http://localhost:4000 and follow the setup guide:

1. **Settings → Upwork accounts**: add the person's name and email. Request a personal API key at [upwork.com/developer](https://www.upwork.com/developer); until it's approved the account uses sample jobs. When it is, paste the client ID, secret and tokens.
2. **Settings → AI providers**: add a key (Groq is free at console.groq.com) or your Ollama server address, press "Test with a sample job", and set the default order.
3. **Appliers → New applier**: start from a template, upload a resume, add past work, and save.
4. Drafts appear in **Review drafts** as the appliers check for jobs (every 15 minutes to 3 hours, per applier), or press **Check now**.

### Developing

```bash
npm run dev          # API on :4000 (auto-reload) and Vite on :5173 with /api proxied
npm test             # server unit tests
npm run typecheck
```

## How it's built

- `server/`: Fastify + Drizzle ORM on Postgres. `src/pipeline` holds the job sources (sample jobs and the Upwork GraphQL client), hard filters, prompts, AI provider clients and the run loop; `src/api` the HTTP routes ([docs/API.md](docs/API.md)). API keys and tokens are encrypted at rest with `APP_SECRET` (generated into `server/data/` if not set; back it up).
- `web/`: React + Vite + TanStack Query, plain CSS.

Each run: search the account's jobs → skip ones already seen → hard filters (no AI cost) → AI score → draft only above the applier's threshold → optional Telegram alert.

### Notes

- The Upwork GraphQL query lives in `server/src/pipeline/sources/upwork.ts`. Check its field names against Upwork's API explorer once your key is approved.
- Uploaded resumes and videos are stored under `server/uploads/`.
