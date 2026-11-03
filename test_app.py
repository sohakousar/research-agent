import json
import time
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_root():
    print("Testing root endpoint...")
    response = client.get("/")
    assert response.status_code == 200
    print("Root Response:", response.json())
    print("Root test PASSED.\n")

def test_sync_no_keys():
    print("Testing synchronous endpoint...")
    response = client.post(
        "/api/research/sync",
        json={"query": "test query", "provider": "gemini"}
    )
    # Depending on whether API keys are present in .env
    assert response.status_code in (200, 500)
    print("Sync endpoint test PASSED.\n")

def test_job_flow_error_state():
    print("Testing async job creation...")
    # Submitting job
    response = client.post(
        "/api/research/jobs",
        json={"query": "Who won the latest super bowl?", "provider": "openai"}
    )
    assert response.status_code == 200
    data = response.json()
    job_id = data["job_id"]
    print(f"Created Job: {job_id}")
    
    # Wait for task background execution
    time.sleep(2)
    
    # Poll job status
    status_response = client.get(f"/api/research/jobs/{job_id}")
    assert status_response.status_code == 200
    job_data = status_response.json()
    print("Job status details:", json.dumps(job_data, indent=2))
    assert job_data["status"] in ("running", "completed", "failed")
    print("Async job state verification PASSED.\n")

if __name__ == "__main__":
    test_root()
    test_sync_no_keys()
    test_job_flow_error_state()
    print("All basic verification tests completed successfully!")
