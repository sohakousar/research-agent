import httpx
import json

def main():
    url = "http://127.0.0.1:8000/api/research/sync"
    
    payload = {
        "query": "capital of France",
        "provider": "gemini"
    }
    
    print(f"Sending request to {url} with payload {json.dumps(payload)}...")
    
    try:
        response = httpx.post(url, json=payload, timeout=90.0)
        print("\nResponse Status Code:", response.status_code)
        print("Response Body:")
        print(json.dumps(response.json(), indent=2))
    except Exception as e:
        print(f"Error querying active server: {e}")

if __name__ == "__main__":
    main()
