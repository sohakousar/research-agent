import asyncio
import json
import os
from dotenv import load_dotenv
from app.agent import ResearcherAgent

# Load local environment variables from .env
load_dotenv()

async def main():
    # We will research a time-sensitive, interesting query
    query = "What is the current status of NASA's Artemis program as of mid-2026?"
    
    print("=" * 60)
    print(f"Starting Research Agent (Using Groq)")
    print(f"Query: {query}")
    print("=" * 60)

    agent = ResearcherAgent(
        provider="groq"
    )
    
    async for event in agent.run(query):
        event_type = event["type"]
        event_data = event.get("data")
        
        if event_type == "status":
            print(f"\n[*] Status: {event_data}")
        elif event_type == "sub_questions":
            print(f"[*] Sub-questions identified: {event_data}")
        elif event_type == "thought":
            print(f"\n[Thought]: {event_data.strip()}")
        elif event_type == "search_query":
            print(f"[*] Searching web for: '{event_data}'")
        elif event_type == "search_results":
            query_str = event_data["query"]
            results = event_data["results"]
            print(f"[*] Search returned results.")
        elif event_type == "fetch_start":
            print(f"[*] Fetching page content: {event_data}")
        elif event_type == "fetch_results":
            print(f"[*] Page fetched successfully ({event_data['length']} characters)")
        elif event_type == "note_saved":
            finding = event_data["finding"]
            url = event_data["source_url"]
            print(f"  [+] Note Saved: \"{finding}\" (Source: {url})")
        elif event_type == "final_result":
            print("\n" + "=" * 60)
            print("FINAL RESEARCH REPORT")
            print("=" * 60)
            print(f"\nANSWER:\n{event_data['answer']}")
            print("\nSOURCES USED:")
            for idx, src in enumerate(event_data['sources']):
                print(f"  {idx+1}. {src}")
            print(f"\nCONFIDENCE / GAPS:\n{event_data['confidence_gaps']}")
            print("=" * 60)
        elif event_type == "error":
            print(f"\n[!] Error: {event_data}")

if __name__ == "__main__":
    asyncio.run(main())