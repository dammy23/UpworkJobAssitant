# Upwork Job Assistant

Finds Upwork jobs for each of your "appliers", filters and scores them with an LLM, and drafts proposals for you to review. **It never submits anything for you**: you edit each draft and submit it yourself on Upwork, which keeps your account within Upwork's terms.

> Work in progress. The database schema and the job pipeline (fixtures source, Upwork GraphQL client, filters, LLM scoring and drafting, Telegram alerts) are in place. Still to come: multiple Upwork accounts and AI-provider settings stored in the database, the HTTP API, and the web UI.

## Run it locally

```bash
cp .env.example .env
docker compose up -d db        # Postgres 16
npm install
npm run db:migrate
```

With `JOB_SOURCE=fixtures` (the default) the pipeline uses sample jobs across many roles, so you can try it before Upwork approves your API key. Leave `GROQ_API_KEY` empty to use an offline heuristic scorer.

## Layout

- `server/src/db`: Drizzle schema and migrations (`appliers`, `materials`, `jobs`, `job_matches`, `applications`)
- `server/src/pipeline`: job sources, hard filters, prompts, LLM clients, Telegram alerts, the run loop
