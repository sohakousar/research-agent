# 🛰️ Deep Research — Autonomous Web Research Agent

An autonomous AI research agent that breaks down a question, searches the web, reads sources, saves findings, and synthesizes a sourced answer, streamed live to a browser-based "evidence board" interface.

Built with **FastAPI**, a provider-agnostic LLM layer (**Google Gemini** by default, **Groq** and others supported), and a self-contained HTML/CSS/JS frontend. No build step required.

**Live demo:** https://research-agent-1-6x0b.onrender.com
*(Free Render tier: the first load after idling can take 50 seconds or more.)*

---

## ✨ Features

- **Autonomous agent loop**: the model decides when to break down a query, search, fetch pages, save notes, or finish, using native tool calling.
- **Multiple LLM providers**: Gemini, Groq, OpenRouter and Cerebras through one OpenAI-compatible client (`app/llm.py`). Gemini is the default and has a free tier.
- **Live streaming UI**: every step (searching, reading, saving a finding) streams to the browser in real time over Server-Sent Events (SSE).
- **Sourced, synthesized answers**: the final report has the answer, a numbered source list, and a confidence/gaps statement.
- **Three ways to run a query**: real-time SSE stream, blocking synchronous call, or an async background job you can poll.
- **Resilient search**: uses `ddgs` first, with an HTML-scraping fallback.
- **Model box in the UI**: type any model name to switch models without editing code (useful when a free daily quota runs out).
- **Mock mode**: a keyless, simulated run for testing the frontend without spending tokens.

---

## 🧱 Architecture

```
app/
├── main.py       FastAPI app: routes, SSE streaming, background jobs
├── agent.py      ResearcherAgent: the core tool-calling loop
├── llm.py        Provider registry (Gemini, Groq, OpenRouter, Cerebras)
├── search.py     Web search (ddgs, with HTML scraping fallback)
├── fetch.py      Fetches and cleans page content (httpx + BeautifulSoup)
└── config.py     Settings (pydantic-settings, reads from .env)

static/
└── index.html    Self-contained frontend (HTML + CSS + JS, no build step)
```

**The agent loop:**
1. Break the query into sub-questions (`break_down_query`)
2. Search the web for candidate sources (`search_web`)
3. Fetch and read the most promising pages (`fetch_url`)
4. Save relevant facts as they are found (`save_note`)
5. Call `finish` with the synthesized answer, source list, and confidence/gaps statement

The loop is capped at **5 turns** by default (`max_iterations` in `app/agent.py`) to stay inside free-tier request limits.

Every step is streamed to the frontend as an event: `status`, `thought`, `sub_questions`, `search_query`, `search_results`, `fetch_start`, `fetch_results`, `note_saved`, `final_result`, `error`.

---

## 🚀 Getting Started (Windows)

### Prerequisites
- Python 3.10+
- A free Gemini API key: https://aistudio.google.com/apikey

### 1. Clone and install
```bash
git clone https://github.com/sohakousar/research-agent.git
cd research-agent
pip install -r requirements.txt
```

### 2. Configure environment variables
Create a `.env` file in the project root (never commit it):
```env
DEFAULT_LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-3.5-flash
```

### 3. Run the server
```bash
python -m uvicorn app.main:app --reload --port 8000
```

### 4. Open the app
Visit **http://127.0.0.1:8000**. Choose **Gemini** in the provider dropdown and ask a question.

---

## ⚙️ Configuration

| Variable | Example | Description |
|---|---|---|
| `DEFAULT_LLM_PROVIDER` | `gemini` | `gemini`, `groq`, `openrouter`, `cerebras` or `mock` |
| `GEMINI_API_KEY` | — | Google AI Studio key |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Gemini model to use |
| `GROQ_API_KEY` | — | Optional, for the Groq provider |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model |
| `OPENROUTER_API_KEY` | — | Optional |
| `CEREBRAS_API_KEY` | — | Optional (may require a payment method) |

Model names change often. To list the models your Gemini key can use:
```bash
python -c "import os,httpx;from dotenv import load_dotenv;load_dotenv();r=httpx.get('https://generativelanguage.googleapis.com/v1beta/openai/models',headers={'Authorization':'Bearer '+os.getenv('GEMINI_API_KEY')});print([m['id'] for m in r.json()['data']])"
```

---

## 🔌 API Reference

### `POST /api/research/stream`
Server-Sent Events stream of the full agent run. Used by the frontend.

```json
{
  "query": "What is the current status of NASA's Artemis program?",
  "provider": "gemini",
  "model": "gemini-3.5-flash",
  "api_key": null
}
```
Only `query` is required. The rest fall back to your environment settings.

| Event | Data shape |
|---|---|
| `status` | `string` |
| `thought` | `string` |
| `sub_questions` | `string[]` |
| `search_query` | `string` |
| `search_results` | `{ query, results: [{ title, href, body }] }` |
| `fetch_start` | `string` (URL) |
| `fetch_results` | `{ url, length }` |
| `note_saved` | `{ finding, source_url }` |
| `final_result` | `{ answer, sources: string[], confidence_gaps }` |
| `error` | `string` |

### `POST /api/research/sync`
Same input. Blocks until finished and returns:
```json
{
  "query": "...",
  "provider": "gemini",
  "model": "gemini-3.5-flash",
  "result": { "answer": "...", "sources": [], "confidence_gaps": "..." }
}
```

### `POST /api/research/jobs`
Starts an async background job. Returns `{ job_id, status, query }`.

### `GET /api/research/jobs/{job_id}`
Poll for status (`pending` / `running` / `completed` / `failed`), live events, and the final result.

---

## ☁️ Deployment (Render)

Deployed on [Render](https://render.com) and redeployed automatically on every push to `main`.

- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Environment variables** (Render dashboard > Environment; the `.env` file is not deployed):
  - `DEFAULT_LLM_PROVIDER=gemini`
  - `GEMINI_API_KEY=your_key`
  - `GEMINI_MODEL=gemini-3.5-flash`
- If the build fails on a new Python version, add `PYTHON_VERSION=3.12.3`.

> On Render's free tier the service sleeps after 15 minutes of inactivity. The first request after idling can take 50 seconds or more.

Update workflow:
```bash
git add .
git commit -m "describe your change"
git push
```

---

## 🧯 Troubleshooting

| Problem | Cause and fix |
|---|---|
| **"Rate Limit Restriction"** in the UI | The free tier allows only a small number of requests per day for each model (about 20 for some). Type a different model name in the model box (for example `gemini-3.7-flash` or `gemini-3.6-flash`) and click **Retry Investigation**, or wait for the daily reset (midnight Pacific time). Creating a key in a new Google project also gives fresh quota. |
| **"API Key for provider 'gemini' is missing"** | `GEMINI_API_KEY` is not set. Locally, check `.env` (no spaces before the key name). On Render, add it under Environment and redeploy. |
| **404 "model not found"** | The model name is wrong or unavailable to your key. List available models with the command above. |
| **Connection refused when testing** | The server is not running. Start it with the `uvicorn` command first. |
| **Page looks unchanged after an update** | Hard-reload with `Ctrl+F5` or use an Incognito window. |

Each research question can use several LLM requests, so on free tiers start with short questions.

---

## 🛠️ Tech Stack

- **Backend:** FastAPI, Uvicorn, OpenAI-compatible async client (Gemini, Groq, OpenRouter, Cerebras)
- **Search:** `ddgs` (DuckDuckGo), with an `httpx` + BeautifulSoup fallback
- **Fetching:** `httpx` (async) + BeautifulSoup
- **Streaming:** `sse-starlette` (Server-Sent Events)
- **Frontend:** Vanilla HTML/CSS/JS, no framework or build step

---

## 🔒 Security

- Never commit `.env` or paste API keys into chats, issues, or screenshots. `.env` is listed in `.gitignore`.
- If a key is ever exposed, delete it in the provider's console and create a new one.

---

## 📄 License

Add your preferred license here (for example MIT).

---

## 🙋 Author

Built by **Syeda Soha Kousar**
GitHub: https://github.com/sohakousar · LinkedIn: https://www.linkedin.com/in/syeda-soha-kousar/