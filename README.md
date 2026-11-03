# 🛰️ Deep Research — Autonomous Web Research Agent

An autonomous AI research agent that breaks down a question, searches the web, reads sources, saves findings, and synthesizes a sourced answer — streamed live to a browser-based "evidence board" interface.

Built with **FastAPI**, **Groq** (openai/gpt-oss-120b), and a self-contained HTML/CSS/JS frontend — no build step required.

---

## ✨ Features

- **Autonomous agent loop** — the model decides for itself when to break down a query, search, fetch pages, save notes, or finish, using Groq's native tool-calling.
- **Live streaming UI** — every step (searching, reading, saving a finding) streams to the browser in real time over Server-Sent Events (SSE), rendered as an evidence board with sub-questions, search results, fetched sources, and pinned findings.
- **Sourced, synthesized answers** — the final report includes the synthesized answer, a numbered source list, and an explicit confidence/gaps statement — not a dump of raw search results.
- **Three ways to run a query**: real-time SSE stream, a blocking synchronous call, or an async background job you can poll.
- **Resilient search** — uses the `ddgs` library first, with an HTML-scraping fallback if that fails.
- **Mock mode** — a keyless, fully simulated agent run for testing the frontend without hitting the Groq API or burning tokens.

---

## 🧱 Architecture

```
app/
├── main.py       FastAPI app — routes, SSE streaming, background jobs
├── agent.py      ResearcherAgent — the core tool-calling loop (Groq)
├── search.py     Web search (ddgs, with HTML scraping fallback)
├── fetch.py      Fetches and cleans page content (httpx + BeautifulSoup)
└── config.py     Settings (pydantic-settings, reads from .env)

static/
└── index.html    Self-contained frontend (HTML + CSS + JS, no build step)
```

**The agent loop**, at a high level:
1. Model breaks the query into sub-questions (`break_down_query`)
2. Model searches the web for candidate sources (`search_web`)
3. Model fetches and reads the most promising pages (`fetch_url`)
4. Model saves relevant facts as it finds them (`save_note`)
5. Model calls `finish` once it has enough convergent evidence, producing the final synthesized answer, source list, and confidence/gaps statement

Every step above is streamed to the frontend as a distinct event type (`status`, `thought`, `sub_questions`, `search_query`, `search_results`, `fetch_start`, `fetch_results`, `note_saved`, `final_result`, `error`).

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- A [Groq API key](https://console.groq.com/keys)

### 1. Clone and install dependencies
```bash
git clone https://github.com/sohakousar/research-agent.git
cd research-agent
pip install -r requirements.txt
```

### 2. Configure environment variables
Copy `.env.example` to `.env` and fill in your key:
```bash
cp .env.example .env
```
```env
GROQ_API_KEY=your_actual_groq_key
DEFAULT_LLM_PROVIDER=groq
GROQ_MODEL=openai/gpt-oss-120b
```

### 3. Run the server
```bash
python -m uvicorn app.main:app --reload --port 8000
```

### 4. Open the app
Visit **http://127.0.0.1:8000** — the frontend is served automatically from `static/index.html`.

---

## 🔌 API Reference

### `POST /api/research/stream`
Server-Sent Events stream of the full agent run in real time. Used by the frontend.

**Body:**
```json
{
  "query": "What is the current status of NASA's Artemis program?",
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "api_key": null
}
```
Only `query` is required — the rest fall back to your `.env` settings.

**Event stream shapes:**

| Event | Data shape |
|---|---|
| `status` | `string` — e.g. `"Iteration 2: Reasoning..."` |
| `thought` | `string` — the model's reasoning text |
| `sub_questions` | `string[]` |
| `search_query` | `string` |
| `search_results` | `{ query: string, results: [{ title, href, body }] }` |
| `fetch_start` | `string` (URL) |
| `fetch_results` | `{ url: string, length: number }` |
| `note_saved` | `{ finding: string, source_url: string }` |
| `final_result` | `{ answer: string, sources: string[], confidence_gaps: string }` |
| `error` | `string` |

### `POST /api/research/sync`
Same input, blocks until finished, returns the final result directly:
```json
{
  "query": "...",
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "result": { "answer": "...", "sources": [...], "confidence_gaps": "..." }
}
```

### `POST /api/research/jobs`
Starts an async background job. Returns `{ job_id, status, query }`.

### `GET /api/research/jobs/{job_id}`
Poll for job status (`pending` / `running` / `completed` / `failed`), live event history, and the final result once ready.

---

## 🖥️ Frontend

`static/index.html` is a single self-contained file — no npm, no build step. It:
- Connects to `/api/research/stream` via `fetch()` + `ReadableStream` (since `EventSource` only supports GET, and this endpoint needs a POST body)
- Renders each event as it arrives: a checklist of sub-questions, live search/fetch cards, pinned findings, and a final report card
- Handles rate-limit errors from Groq specifically, with a retry option
- Respects `prefers-reduced-motion` and is fully responsive

---

## ⚙️ Configuration

All settings are read from environment variables (via `.env` locally, or your host's environment variable settings in production):

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | Your Groq API key (required) |
| `DEFAULT_LLM_PROVIDER` | `groq` | Only `groq` (or `mock` for testing) is supported |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model to use |

---

## ☁️ Deployment (Render)

This project is deployed on [Render](https://render.com):

- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Environment Variables:** set `GROQ_API_KEY`, `DEFAULT_LLM_PROVIDER`, `GROQ_MODEL` in the Render dashboard (never commit real keys to the repo)

> **Note:** On Render's free tier, the service spins down after 15 minutes of inactivity. The first request after idling can take 30–60 seconds to wake back up.

---

## 🛠️ Tech Stack

- **Backend:** FastAPI, Uvicorn, Groq SDK (native `AsyncGroq` client, tool-calling)
- **Search:** `ddgs` (DuckDuckGo), with an `httpx` + BeautifulSoup HTML-scraping fallback
- **Fetching:** `httpx` (async) + BeautifulSoup for content extraction
- **Streaming:** `sse-starlette` (Server-Sent Events)
- **Frontend:** Vanilla HTML/CSS/JS, no framework or build step

---

## 📄 License

Add your preferred license here (e.g. MIT).

---

## 🙋 Author

Built by **Syeda Soha Kousar**
