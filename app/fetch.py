import logging
# pyrefly: ignore [missing-import]
import httpx
# pyrefly: ignore [missing-import]
from bs4 import BeautifulSoup

logger = logging.getLogger("researcher-agent")

async def fetch_url(url: str, timeout: int = 10) -> str:
    """
    Fetch a URL asynchronously, parse the HTML, and return cleaned text content.
    Only extracts main textual contents, stripping scripts, stylesheets, navs, and footers.
    """
    logger.info(f"Fetching URL: {url}")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }
    try:
        async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=timeout) as client:
            response = await client.get(url)
            if response.status_code != 200:
                msg = f"Error: Status code {response.status_code}"
                logger.warning(f"Failed to fetch {url}: {msg}")
                return msg
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove noise
            for element in soup(["script", "style", "nav", "footer", "header", "form", "iframe", "noscript"]):
                element.decompose()
            
            # Focus on main content sections if they exist
            content_area = soup.find('main') or soup.find('article') or soup.body or soup
            
            # Extract text
            text = content_area.get_text(separator='\n')
            
            # Clean text whitespace
            lines = []
            for line in text.splitlines():
                stripped = line.strip()
                if stripped:
                    lines.append(stripped)
            
            cleaned_text = '\n'.join(lines)
            
            # Truncate if content is excessively long to prevent model context flooding
            max_chars = 15000
            if len(cleaned_text) > max_chars:
                cleaned_text = cleaned_text[:max_chars] + "\n\n[Content truncated due to length limits]"
                
            logger.info(f"Successfully parsed URL {url} ({len(cleaned_text)} chars)")
            return cleaned_text
            
    except Exception as e:
        msg = f"Error: {str(e)}"
        logger.error(f"Failed to fetch URL {url}: {msg}")
        return msg
