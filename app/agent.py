import re
import json
import os
from app.llm import PROVIDERS
import logging
import asyncio
from typing import AsyncGenerator, Any, Dict, List, Optional
from app.config import settings
from app.search import search_web
from app.fetch import fetch_url

logger = logging.getLogger("researcher-agent")

SYSTEM_INSTRUCTION = """You are a research agent. Your job is to answer the user's query with accurate, well-sourced findings by searching the web, reading sources, and synthesizing information.

Process:
1. Break down the query into sub-questions if it's multi-part or ambiguous. Use `break_down_query` to store them.
2. Search before answering. Never rely on prior knowledge for facts that could be outdated, specific, or contested. Use `search_web` to find candidate sources.
3. Fetch selectively. Search snippets are often too shallow. Use `fetch_url` on the most promising 2-4 results per sub-question to get full content — don't fetch everything indiscriminately.
4. Save findings as you go. Use `save_note(finding, source_url)` immediately after extracting a relevant fact. Do not wait until the end to recall what you read — externalize it.
5. Cross-check. If sources disagree, note the disagreement explicitly rather than silently picking one. Prefer primary/original sources over aggregators.
6. Know when to stop. Stop searching once you have enough convergent evidence to answer confidently, or once you've exhausted reasonable search angles. Don't loop indefinitely chasing marginal detail.
7. Synthesize, don't dump. Your final answer should be a synthesized response in your own words, not a list of search results. Every non-obvious claim should be traceable to a saved note/source.

Rules:
- If you cannot find reliable information after reasonable effort, say so explicitly rather than guessing.
- Do not fabricate sources or attribute claims to sources that didn't say them.
- Flag low-confidence claims as such.
- If the query is time-sensitive (current events, prices, versions, "latest X"), prioritize recency over authority when sources conflict.
- Keep tool calls purposeful — each search/fetch should target a specific gap in your understanding, not be exploratory for its own sake.

When you are ready to compile the final report, call the `finish` tool. You must call `finish` to end the research process.
"""

# Tool definitions in standard OpenAPI/JSON Schema format
TOOLS_SCHEMA = [
    {
        "name": "break_down_query",
        "description": "Break the original query into smaller, specific sub-questions to guide research.",
        "parameters": {
            "type": "object",
            "properties": {
                "sub_questions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of sub-questions."
                }
            },
            "required": ["sub_questions"]
        }
    },
    {
        "name": "search_web",
        "description": "Search the web for a query to find candidate sources (titles, URLs, snippets).",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query."
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "fetch_url",
        "description": "Fetch the full main text content of a promising webpage/URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch."
                }
            },
            "required": ["url"]
        }
    },
    {
        "name": "save_note",
        "description": "Save a relevant fact or finding immediately after extracting it from a source.",
        "parameters": {
            "type": "object",
            "properties": {
                "finding": {
                    "type": "string",
                    "description": "The extracted fact or finding."
                },
                "source_url": {
                    "type": "string",
                    "description": "The source URL of the finding."
                }
            },
            "required": ["finding", "source_url"]
        }
    },
    {
        "name": "finish",
        "description": "Finish the research process and compile the final synthesized report.",
        "parameters": {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "description": "The synthesized answer to the main query."
                },
                "sources": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of URLs actually used in order of relevance."
                },
                "confidence_gaps": {
                    "type": "string",
                    "description": "A brief statement on any unresolved uncertainties or gaps in info."
                }
            },
            "required": ["answer", "sources", "confidence_gaps"]
        }
    }
]

# Cap on how much fetched page text we keep in the running message history.
# fetch_url() already truncates each page to 15k chars; this is an additional
# cap applied when the content is inserted into the tool-result message so
# that 2-3 fetches in a row can't blow the context/TPM budget.
MAX_TOOL_RESULT_CHARS = 4000


class ResearcherAgent:
    def __init__(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        max_iterations: int = 5
    ):
        self.provider = provider or settings.default_llm_provider
        self.max_iterations = max_iterations
        self.sub_questions: List[str] = []
        self.notes: List[Dict[str, str]] = []
        self.searches_conducted: List[str] = []
        self.urls_fetched: List[str] = []
        self.finished = False
        self.final_result: Optional[Dict[str, Any]] = None
        # Raw structured results from the most recent search_web call, kept
        # separately from the formatted text string fed to the LLM, so the
        # frontend can render title/href/body per result instead of a blob.
        self.last_raw_search_results: List[Dict[str, str]] = []

        # Configure model and keys for any provider in PROVIDERS or mock
        if self.provider == "mock":
            self.model = "mock-model"
            self.api_key = "mock-key"
        else:
            if self.provider not in PROVIDERS:
                self.provider = "gemini" if "gemini" in PROVIDERS else "groq"
            provider_cfg = PROVIDERS[self.provider]

            # If the provider is not "groq", ignore any model name containing "gpt-oss"
            # sent by the frontend or request, and use {PROVIDER}_MODEL or default_model
            if self.provider != "groq" and model and "gpt-oss" in model:
                model = None

            self.model = model or os.getenv(f"{self.provider.upper()}_MODEL") or provider_cfg["default_model"]
            self.api_key = api_key or os.getenv(provider_cfg["key_env"])

    async def run(self, query: str) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Runs the research agent loop asynchronously and yields state updates.
        """
        if not self.api_key:
            yield {
                "type": "error",
                "data": f"API Key for provider '{self.provider}' is missing. Please configure it in your environment."
            }
            return

        yield {"type": "status", "data": f"Initializing Research Agent with {self.provider} ({self.model})..."}

        if self.provider == "mock":
            async for event in self._run_mock(query):
                yield event
        else:
            async for event in self._run_llm(query):
                yield event

    async def _run_llm(self, query: str) -> AsyncGenerator[Dict[str, Any], None]:
        try:
            # pyrefly: ignore [missing-import]
            from openai import AsyncOpenAI
        except ImportError:
            yield {"type": "error", "data": "openai package is not installed. Run: pip install openai"}
            return

        try:
            client = AsyncOpenAI(api_key=self.api_key, base_url=PROVIDERS[self.provider]["base_url"])
        except Exception as e:
            yield {"type": "error", "data": f"Failed to initialize LLM Client: {e}"}
            return

        tools = []
        for t in TOOLS_SCHEMA:
            tools.append({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"]
                }
            })

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_INSTRUCTION},
            {"role": "user", "content": f"Original Query: {query}\n\nStart your research by breaking down the query or searching the web."}
        ]

        iteration = 0
        while not self.finished and iteration < self.max_iterations:
            iteration += 1
            yield {"type": "status", "data": f"Iteration {iteration}: Reasoning..."}

            # Update state via a single message that we replace each iteration
            # rather than appending a fresh copy every time (keeps history lean).
            state_msg = (
                f"[SYSTEM UPDATE]\n"
                f"Current Sub-questions: {json.dumps(self.sub_questions)}\n"
                f"Notes saved so far: {len(self.notes)}\n"
                f"Searches Conducted: {json.dumps(self.searches_conducted)}\n"
                f"URLs Fetched: {json.dumps(self.urls_fetched)}\n"
                f"Please choose your next tool call based on these findings."
            )
            messages.append({"role": "user", "content": state_msg})

            response = None
            max_retries = 3
            for attempt in range(1, max_retries + 1):
                try:
                    response = await client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        tools=tools,
                        tool_choice="auto",
                        temperature=0.2
                    )
                    break
                except Exception as e:
                    err_msg = str(e)
                    is_transient = any(code in err_msg for code in ["503", "429", "timeout", "high demand", "RESOURCE_EXHAUSTED", "Quota exceeded"])
                    if is_transient and attempt < max_retries:
                        delay = 10 * attempt
                        match = re.search(r"retry in ([0-9]+(?:\.[0-9]+)?)s", err_msg)
                        if match:
                            delay = min(float(match.group(1)) + 1.0, 30.0)
                        yield {"type": "status", "data": f"Rate limit / high demand on {self.provider}. Retrying in {int(delay)}s (attempt {attempt}/{max_retries})..."}
                        await asyncio.sleep(delay)
                    else:
                        yield {"type": "error", "data": f"LLM Generation Error: {err_msg}"}
                        return

            response_message = response.choices[0].message

            # IMPORTANT: response_message is an SDK pydantic object
            # (ChatCompletionMessage), not a plain dict. Appending it directly
            # to `messages` and sending it back to Groq on the next iteration
            # can cause the request to be rejected (extra/null fields like
            # `refusal`, `function_call`, `audio`, etc. don't round-trip
            # cleanly through Groq's OpenAI-compatible endpoint). Convert to a
            # clean dict before appending.
            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                "content": response_message.content or None,
            }
            if response_message.tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in response_message.tool_calls
                ]
            messages.append(assistant_msg)

            if response_message.content:
                yield {"type": "thought", "data": response_message.content}

            tool_calls = response_message.tool_calls
            if not tool_calls:
                yield {"type": "thought", "data": "Model did not make a tool call. Requesting tool execution..."}
                messages.append({
                    "role": "user",
                    "content": "You did not call any tools. You must call a tool to advance the research, or call 'finish' if you are done."
                })
                continue

            for tool_call in tool_calls:
                name = tool_call.function.name
                call_id = tool_call.id

                try:
                    args = json.loads(tool_call.function.arguments)
                except Exception:
                    args = {}

                yield {"type": "status", "data": f"Executing tool: {name}"}

                tool_result = await self._execute_tool(name, args)

                if name == "break_down_query":
                    yield {"type": "sub_questions", "data": self.sub_questions}
                elif name == "search_web":
                    yield {"type": "search_query", "data": args.get("query")}
                    yield {"type": "search_results", "data": {"query": args.get("query"), "results": self.last_raw_search_results}}
                elif name == "fetch_url":
                    yield {"type": "fetch_start", "data": args.get("url")}
                    yield {"type": "fetch_results", "data": {"url": args.get("url"), "length": len(tool_result)}}
                elif name == "save_note":
                    yield {"type": "note_saved", "data": {"finding": args.get("finding"), "source_url": args.get("source_url")}}
                elif name == "finish":
                    self.finished = True
                    self.final_result = {
                        "answer": args.get("answer"),
                        "sources": args.get("sources"),
                        "confidence_gaps": args.get("confidence_gaps")
                    }
                    yield {"type": "final_result", "data": self.final_result}
                    break

                # Cap the size of tool result content that goes back into the
                # message history, so a few fetch_url calls in a row can't
                # blow the context / tokens-per-minute budget on Groq.
                result_str = json.dumps({"result": tool_result})
                if len(result_str) > MAX_TOOL_RESULT_CHARS:
                    truncated_result = tool_result
                    if isinstance(truncated_result, str) and len(truncated_result) > MAX_TOOL_RESULT_CHARS:
                        truncated_result = truncated_result[:MAX_TOOL_RESULT_CHARS] + "\n[...truncated for context budget...]"
                    result_str = json.dumps({"result": truncated_result})

                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": result_str
                })

            if self.finished:
                break

        if not self.finished:
            yield {"type": "error", "data": "Reached maximum iterations without finishing."}

    _run_groq = _run_llm

    async def _run_mock(self, query: str) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Simulates a high-fidelity research loop yielding streaming updates.
        Allows testing the frontend without invoking live LLM keys or rate limits.
        """
        yield {"type": "status", "data": f"Initializing Research Agent with mock ({self.model})..."}
        await asyncio.sleep(0.8)

        # Iteration 1: break_down_query
        yield {"type": "status", "data": "Iteration 1: Reasoning..."}
        yield {
            "type": "thought",
            "data": f"To answer the query '{query}', I first need to structure the research. I will break it down into specific sub-questions."
        }
        await asyncio.sleep(1.0)
        yield {"type": "status", "data": "Executing tool: break_down_query"}
        self.sub_questions = [
            f"What are the core aspects of '{query}'?",
            f"What is the historical background of '{query}'?",
            f"Are there any recent updates regarding '{query}'?"
        ]
        yield {"type": "sub_questions", "data": self.sub_questions}
        await asyncio.sleep(1.0)

        # Iteration 2: search_web
        yield {"type": "status", "data": "Iteration 2: Reasoning..."}
        yield {
            "type": "thought",
            "data": "Now that the query is structured, I will perform a search on the web to locate relevant articles and candidate sources."
        }
        await asyncio.sleep(1.0)
        yield {"type": "status", "data": "Executing tool: search_web"}
        yield {"type": "search_query", "data": query}
        mock_search_results = [
            {
                "title": f"Official Guide to {query}",
                "href": "https://example.com/official",
                "body": f"Comprehensive information regarding {query} including history and recent developments."
            },
            {
                "title": f"Recent Developments in {query}",
                "href": "https://example.com/news",
                "body": f"Latest news updates about {query} as of 2026."
            }
        ]
        yield {
            "type": "search_results",
            "data": {
                "query": query,
                "results": mock_search_results
            }
        }
        await asyncio.sleep(1.2)

        # Iteration 3: fetch_url
        yield {"type": "status", "data": "Iteration 3: Reasoning..."}
        yield {
            "type": "thought",
            "data": "The search returned high-quality candidate sources. I will fetch the full main content from the official guide to extract specific facts."
        }
        await asyncio.sleep(1.0)
        yield {"type": "status", "data": "Executing tool: fetch_url"}
        target_url = "https://example.com/official"
        yield {"type": "fetch_start", "data": target_url}
        yield {
            "type": "fetch_results",
            "data": {
                "url": target_url,
                "length": 1250
            }
        }
        await asyncio.sleep(1.0)

        # Iteration 4: save_note
        yield {"type": "status", "data": "Iteration 4: Reasoning..."}
        yield {
            "type": "thought",
            "data": "I have successfully retrieved the content. I will now save a key finding regarding the core aspects of the query to my internal notes."
        }
        await asyncio.sleep(1.0)
        yield {"type": "status", "data": "Executing tool: save_note"}
        note_finding = f"Fact: '{query}' is highly regarded and has experienced significant evolution recently, particularly in mid-2026."
        self.notes.append({"finding": note_finding, "source_url": target_url})
        yield {
            "type": "note_saved",
            "data": {
                "finding": note_finding,
                "source_url": target_url
            }
        }
        await asyncio.sleep(1.0)

        # Iteration 5: finish
        yield {"type": "status", "data": "Iteration 5: Reasoning..."}
        yield {
            "type": "thought",
            "data": "I have enough convergent evidence from my research. I will compile the final report using the finish tool."
        }
        await asyncio.sleep(1.0)
        yield {"type": "status", "data": "Executing tool: finish"}
        self.finished = True
        self.final_result = {
            "answer": (
                f"### Synthesized Research Report: {query}\n\n"
                f"Based on our mock autonomous web research, here is the synthesized summary:\n\n"
                f"1. **Core Concept**: Researching '{query}' reveals it is a subject of significant interest, with active developments leading into mid-2026.\n"
                f"2. **Primary Source Analysis**: The official guide (https://example.com/official) confirms that key protocols and standards are evolving to meet modern demands.\n"
                f"3. **Conclusion**: The topic remains relevant with a solid historical foundation and high engagement across the industry.\n\n"
                f"*(Note: This is a high-fidelity mock research execution designed to demonstrate the frontend workflow.)*"
            ),
            "sources": [
                "https://example.com/official",
                "https://example.com/news"
            ],
            "confidence_gaps": "As this is a mock agent run, no live external data feeds were parsed for deeper real-time accuracy."
        }
        yield {"type": "final_result", "data": self.final_result}

    async def _execute_tool(self, name: str, args: Dict[str, Any]) -> Any:
        """
        Executes local tools based on agent calls and updates internal state tracking.
        """
        try:
            if name == "break_down_query":
                sub_qs = args.get("sub_questions", [])
                self.sub_questions = sub_qs
                return f"Sub-questions recorded: {sub_qs}"

            elif name == "search_web":
                query = args.get("query", "")
                self.searches_conducted.append(query)
                # Call DDG search — offloaded to a thread since search_web is a blocking sync call
                results = await asyncio.to_thread(search_web, query)
                # Keep the raw structured list for the frontend's search_results event
                self.last_raw_search_results = results
                # Formats list of results to text format for LLM review
                formatted_results = []
                for idx, r in enumerate(results):
                    formatted_results.append(
                        f"[{idx+1}] Title: {r['title']}\nURL: {r['href']}\nSnippet: {r['body']}\n"
                    )
                return "\n".join(formatted_results) or "No results found."

        
            elif name == "fetch_url":
                url = args.get("url", "")
                self.urls_fetched.append(url)
                # Fetch text contents
                content = await fetch_url(url)
                return content

            elif name == "save_note":
                finding = args.get("finding", "")
                url = args.get("source_url", "")
                self.notes.append({"finding": finding, "source_url": url})
                return f"Note successfully saved: '{finding}' from {url}"

            elif name == "finish":
                # Final compilation tool, values read from args
                return "Finished"

            else:
                return f"Error: Tool '{name}' is not supported."
        except Exception as e:
            logger.error(f"Error executing tool '{name}': {e}")
            return f"Error executing tool: {str(e)}"