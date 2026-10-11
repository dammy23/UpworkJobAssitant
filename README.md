# Upwork Job Assistant

Finds Upwork jobs for each of your **appliers**, filters and scores them with AI, and drafts a proposal for the good ones, including your bid, duration and answers to the client's screening questions. You approve each proposal with one click in the app or one tap in Telegram, and the app sends it from the right Upwork account.

**Nothing is sent without your approval of that specific proposal.** Upwork's terms forbid bots that submit proposals without a person reviewing each one, so there is no auto-send, no "approve all" and no timer. Approved proposals go out one at a time per account within limits you set: a daily cap, a minimum gap between sends and an optional weekly Connects budget.

## What it does

- **Appliers for any kind of work**: virtual assistant, writer, bookkeeper, customer support, designer, translator, developer, or your own. Each has its role titles, skills, words to avoid, pay and client rules, resume, intro video, past work and tone of voice.
- **Several Upwork accounts**: each applier belongs to one account (for example yours and a teammate's). Upwork allows one freelancer account per person.
- **Your choice of AI**: Groq (free tier), Claude, OpenAI or Ollama on your own computer, set up in Settings, with a default order and automatic fallback. Each applier can pick its own.
- **Review screen**: the job post beside the reply, a fit score with reasons and concerns, one-click rewrites (new version, shorter, warmer, more specific), bid, duration and screening answers (AI can write them), then **Submit proposal**. Tick several drafts to approve them together; each is still checked and sent individually.
- **One-tap approval in Telegram**: each new draft arrives with Submit and Skip buttons. Only taps from your linked chat count.
- **Send queue**: shows what's waiting and why (for example "Daily limit reached"). You can take a proposal back out until it starts sending. If Upwork refuses one, it's shown with Upwork's reason so you can fix it and retry. After a crash the app never resends automatically; it asks you to check Upwork first.
- **Applied jobs**: every proposal you sent, its status, notes and Connects spent, with CSV export.
- **Telegram alerts** for new drafts (optional).
- **Sample jobs and test sends** until an account is signed in to Upwork, so everything can be tried straight away: the whole flow runs but nothing goes to Upwork. With no AI provider set up, a simple offline scorer is used.

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

1. **Settings → Upwork accounts**: add the person's name and email. Request an API key at [upwork.com/developer](https://www.upwork.com/developer) with:
   - **Callback URL** `http://localhost:4000/api/upwork/callback`
   - **Permissions**: Common Entities (read-only), Read marketplace Job Postings, Submit Proposal
   - An honest description: it finds jobs, drafts proposals, and sends each one only after you approve it.

   Keys start disabled until Upwork reviews them; meanwhile the account uses sample jobs and test sends. Once approved, paste the client ID and secret and press **Connect with Upwork**.
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

### Before the first real send

Everything Upwork-specific is in `server/src/pipeline/sources/upwork.ts`. It was built from Upwork's documentation and tested against a stand-in, not the live API, because no key was active yet. Once your account is connected, run

```bash
npm run upwork:schema --workspace server -- "<account name>"
```

and check `CreateJobProposalInput` against `buildProposalInput()` (and the job search fields against `JOB_SEARCH_QUERY` / `mapNode()`). Real jobs' screening questions also need reading from the job posting; until that's mapped, check the job on Upwork for questions before approving. A proposal Upwork rejects is shown as "Not sent" with Upwork's message, never retried blindly.

### Notes

- Uploaded resumes and videos are stored under `server/uploads/`.
