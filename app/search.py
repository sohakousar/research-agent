import logging
import urllib.parse
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("researcher-agent")


def search_web(query: str, max_results: int = 5) -> list[dict]:
    """
    Search the web using DuckDuckGo.
    Uses the ddgs library first, and falls back to manual HTML parsing if needed.
    """
    logger.info(f"Searching web for: {query}")

    # 1. Try using the ddgs library (the maintained successor to duckduckgo_search)
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = ddgs.text(query, max_results=max_results)
            output = []
            for r in results:
                output.append({
                    "title": r.get("title", ""),
                    "href": r.get("href", ""),
                    "body": r.get("body", "")
                })
            if output:
                logger.info(f"ddgs library found {len(output)} results.")
                return output
    except Exception as e:
        logger.warning(f"ddgs library failed, trying HTML scraping fallback. Error: {e}")

    # 2. Fallback to direct HTML parsing
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
        }
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        with httpx.Client(headers=headers, follow_redirects=True, timeout=10) as client:
            response = client.get(url)
            if response.status_code != 200:
                logger.error(f"Fallback search request failed with status: {response.status_code}")
                return []
            soup = BeautifulSoup(response.text, "html.parser")
            output = []
            result_divs = soup.find_all("div", class_="result")
            for div in result_divs[:max_results]:
                title_el = div.find("a", class_="result__a")
                snippet_el = div.find("a", class_="result__snippet")
                if title_el:
                    title = title_el.get_text(strip=True)
                    href = title_el.get("href", "")
                    if "uddg=" in href:
                        parsed = urllib.parse.urlparse(href)
                        qs = urllib.parse.parse_qs(parsed.query)
                        if "uddg" in qs:
                            href = qs["uddg"][0]
                    body = snippet_el.get_text(strip=True) if snippet_el else ""
                    output.append({
                        "title": title,
                        "href": href,
                        "body": body
                    })
            logger.info(f"Fallback search parser found {len(output)} results.")
            return output
    except Exception as e:
        logger.error(f"Fallback search scraper failed: {e}")
        return []
