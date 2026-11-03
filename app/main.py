import json
import uuid
import logging
import asyncio
import os
from typing import Dict, Optional, Any, List
from fastapi import FastAPI, HTTPException, BackgroundTasks, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
# pyrefly: ignore [missing-import]
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.agent import ResearcherAgent

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("researcher-agent")

app = FastAPI(
    title="Researcher Agent API Service",
    description="A backend API service that runs an autonomous web-researching agent loop.",
    version="1.0.0"
)

# CORS middleware to allow client access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure static files directory exists and mount it
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# In-memory database for background jobs
JOBS: Dict[str, Dict[str, Any]] = {}

class ResearchRequest(BaseModel):
    query: str
    provider: Optional[str] = None  # "gemini" or "openai"
    model: Optional[str] = None     # Specific model override
    api_key: Optional[str] = None   # Explicit API key override

class JobResponse(BaseModel):
    job_id: str
    status: str
    query: str

# Helper to resolve API keys from request or env
def resolve_api_key(
    req: ResearchRequest,
    x_groq_key: Optional[str] = None,
    x_gemini_key: Optional[str] = None,
) -> Optional[str]:
    # 1. Check request body override
    if req.api_key:
        return req.api_key
    
    # 2. Check headers
    provider = (req.provider or settings.default_llm_provider or "gemini").lower()
    if provider == "groq":
        return x_groq_key or settings.groq_api_key
    elif provider == "gemini":
        return x_gemini_key or settings.gemini_api_key
    return None

@app.get("/")
async def read_root(request: Request):
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        if os.path.exists("static/index.html"):
            return FileResponse("static/index.html")
    return {
        "name": "Researcher Agent API Service",
        "status": "online",
        "default_provider": settings.default_llm_provider,
        "default_groq_model": settings.groq_model
    }

@app.post("/api/research/sync")
async def research_sync(
    req: ResearchRequest,
    x_groq_key: Optional[str] = Header(None, alias="X-Groq-Key"),
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")
):
    """
    Run the researcher agent synchronously.
    Blocks until the research compiles and returns the final synthesized output.
    """
    api_key = resolve_api_key(req, x_groq_key, x_gemini_key)
    agent = ResearcherAgent(
        provider=req.provider,
        model=req.model,
        api_key=api_key
    )
    
    try:
        # Run agent loop and consume generator to final output
        final_event = None
        async for event in agent.run(req.query):
            if event["type"] == "error":
                raise HTTPException(status_code=500, detail=event["data"])
            if event["type"] == "final_result":
                final_event = event["data"]
        
        if not final_event:
            raise HTTPException(status_code=500, detail="Research loop completed but failed to compile a final answer.")
            
        return {
            "query": req.query,
            "provider": agent.provider,
            "model": agent.model,
            "result": final_event
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during synchronous research: {e}")
        raise HTTPException(status_code=500, detail=f"Research execution failed: {str(e)}")


@app.post("/api/research/stream")
async def research_stream(
    req: ResearchRequest,
    x_groq_key: Optional[str] = Header(None, alias="X-Groq-Key"),
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")
):
    """
    Run the researcher agent and stream status/notes/thought updates in real-time
    using Server-Sent Events (SSE).
    """
    api_key = resolve_api_key(req, x_groq_key, x_gemini_key)
    agent = ResearcherAgent(
        provider=req.provider,
        model=req.model,
        api_key=api_key
    )

    async def event_generator():
        try:
            async for event in agent.run(req.query):
                yield {
                    "event": event["type"],
                    "data": json.dumps(event.get("data", ""))
                }
        except Exception as e:
            logger.error(f"Streaming error: {e}")
            yield {
                "event": "error",
                "data": json.dumps(f"Streaming connection interrupted: {str(e)}")
            }

    return EventSourceResponse(event_generator())

# Background task function for job processing
async def run_agent_job(job_id: str, query: str, provider: Optional[str], model: Optional[str], api_key: Optional[str]):
    agent = ResearcherAgent(
        provider=provider,
        model=model,
        api_key=api_key
    )
    JOBS[job_id]["status"] = "running"
    
    try:
        async for event in agent.run(query):
            # Record events to job history
            JOBS[job_id]["events"].append(event)
            
            # Sync key variables to make details easily retrievable
            if event["type"] == "sub_questions":
                JOBS[job_id]["sub_questions"] = event["data"]
            elif event["type"] == "note_saved":
                JOBS[job_id]["notes"].append(event["data"])
            elif event["type"] == "final_result":
                JOBS[job_id]["status"] = "completed"
                JOBS[job_id]["result"] = event["data"]
            elif event["type"] == "error":
                JOBS[job_id]["status"] = "failed"
                JOBS[job_id]["error"] = event["data"]
                
        if JOBS[job_id]["status"] == "running":
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = "Research loop terminated without returning final result."
            
    except Exception as e:
        logger.error(f"Async job {job_id} failed: {e}")
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)

@app.post("/api/research/jobs", response_model=JobResponse)
async def create_research_job(
    req: ResearchRequest,
    background_tasks: BackgroundTasks,
    x_groq_key: Optional[str] = Header(None, alias="X-Groq-Key"),
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")
):
    """
    Submit a research task to run asynchronously in the background.
    Returns a job_id to track execution status and poll findings.
    """
    job_id = str(uuid.uuid4())
    api_key = resolve_api_key(req, x_groq_key, x_gemini_key)
    
    JOBS[job_id] = {
        "job_id": job_id,
        "query": req.query,
        "status": "pending",
        "sub_questions": [],
        "notes": [],
        "events": [],
        "result": None,
        "error": None
    }
    
    background_tasks.add_task(
        run_agent_job,
        job_id=job_id,
        query=req.query,
        provider=req.provider,
        model=req.model,
        api_key=api_key
    )
    
    return {
        "job_id": job_id,
        "status": "pending",
        "query": req.query
    }

@app.get("/api/research/jobs/{job_id}")
async def get_job_status(job_id: str):
    """
    Retrieve current status, real-time events, findings, and final reports
    from a submitted background job.
    """
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return job
