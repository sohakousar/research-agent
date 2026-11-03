import subprocess
import time
import httpx
import sys

def main():
    print("Starting Uvicorn server in background...")
    # Start the server on port 8000 using the python environment in the venv
    server_process = subprocess.Popen(
        [".venv\\Scripts\\python", "-m", "uvicorn", "app.main:app", "--port", "8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # Wait for the server to spin up
    print("Waiting 5 seconds for server to start...")
    time.sleep(5)
    
    # Check if process is still running
    if server_process.poll() is not None:
        print("Error: Uvicorn server failed to start. Logs:")
        stdout, stderr = server_process.communicate()
        print("STDOUT:", stdout)
        print("STDERR:", stderr)
        sys.exit(1)
        
    print("Server running. Making POST request to /api/research/sync...")
    
    url = "http://127.0.0.1:8000/api/research/sync"
    payload = {
        "query": "What is the capital of France?",
        "provider": "gemini"
    }
    
    try:
        # Paced research sync might take time because of the Gemini agent loop + pacing sleep
        response = httpx.post(url, json=payload, timeout=60.0)
        print("\nResponse Status:", response.status_code)
        print("Response Content:")
        print(json_format(response.json()))
    except Exception as e:
        print(f"Error calling API: {e}")
    finally:
        print("\nShutting down Uvicorn server...")
        server_process.terminate()
        server_process.wait()
        print("Server shutdown completed.")

def json_format(data):
    import json
    return json.dumps(data, indent=2)

if __name__ == "__main__":
    main()
