"""Bộ tìm kiếm tài liệu học thuật mở (arXiv, OpenAlex, Wikipedia) và đọc nội dung URL / PDF (chống SSRF).
- Sửa file này khi muốn thêm nguồn tìm kiếm mới hoặc chỉnh số lượng bài báo trả về.
"""

from __future__ import annotations

import asyncio
import io
import ipaddress
import re
import socket
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from app.storage import utc_now_iso

_USER_AGENT = "ResearchLab/2.0 (Academic Open Search; local)"
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>[\s\S]*?</\1>", re.IGNORECASE)
_TITLE_RE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.IGNORECASE)
_WS_RE = re.compile(r"\s+")
_MAX_FETCH_BYTES = 5 * 1024 * 1024  # 5 MB cap


def clean_text(text: str, max_len: int = 280) -> str:
    normalized = _WS_RE.sub(" ", str(text or "")).strip()
    if len(normalized) <= max_len:
        return normalized
    return normalized[: max_len - 1].rstrip() + "…"


def _is_ip_public(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str.strip("[]"))
        return bool(ip.is_global and not ip.is_private and not ip.is_loopback and not ip.is_link_local)
    except ValueError:
        return False


def is_safe_public_url(raw_url: str, *, resolve_dns: bool = True) -> bool:
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").strip().lower()
    if not host or host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        return False
    if host.endswith((".local", ".internal", ".localhost")):
        return False
    try:
        ipaddress.ip_address(host.strip("[]"))
        return _is_ip_public(host)
    except ValueError:
        pass
    if not resolve_dns:
        return True
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
        addrs = {info[4][0] for info in infos}
        return bool(addrs) and all(_is_ip_public(addr) for addr in addrs)
    except OSError:
        return False


async def _search_arxiv(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    try:
        url = f"https://export.arxiv.org/api/query?search_query=all:{quote(query)}&start=0&max_results=2"
        resp = await client.get(url, timeout=8.0)
        if resp.status_code != 200:
            return []
        root = ET.fromstring(resp.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        out: list[dict[str, Any]] = []
        for entry in root.findall("atom:entry", ns):
            title_el = entry.find("atom:title", ns)
            summary_el = entry.find("atom:summary", ns)
            id_el = entry.find("atom:id", ns)
            pub_el = entry.find("atom:published", ns)
            if title_el is None or id_el is None or not (id_el.text or "").strip():
                continue
            year = (pub_el.text or "")[:4] if pub_el is not None else "Recent"
            out.append(
                {
                    "origin": f"arXiv · {year or 'Recent'}",
                    "title": clean_text(title_el.text or "", 140),
                    "excerpt": clean_text((summary_el.text if summary_el is not None else "") or "Tài liệu nghiên cứu trên arXiv.", 260),
                    "url": (id_el.text or "").strip(),
                    "verified": True,
                    "addedAt": utc_now_iso(),
                }
            )
        return out
    except Exception:
        return []


async def _search_openalex(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    try:
        url = f"https://api.openalex.org/works?search={quote(query)}&per-page=2"
        resp = await client.get(url, timeout=8.0)
        if resp.status_code != 200:
            return []
        data = resp.json()
        out: list[dict[str, Any]] = []
        for item in data.get("results") or []:
            title = item.get("title")
            if not title:
                continue
            excerpt = "Công trình học thuật lập chỉ mục trên OpenAlex."
            inv = item.get("abstract_inverted_index")
            if isinstance(inv, dict) and inv:
                max_pos = max((max(positions) for positions in inv.values() if positions), default=-1)
                if max_pos >= 0:
                    words = [""] * (min(max_pos, 400) + 1)
                    for word, positions in inv.items():
                        for pos in positions:
                            if 0 <= pos < len(words):
                                words[pos] = word
                    reconstructed = " ".join(w for w in words if w)
                    if reconstructed:
                        excerpt = clean_text(reconstructed, 260)
            out.append(
                {
                    "origin": f"OpenAlex · {item.get('publication_year') or 'Recent'}",
                    "title": clean_text(title, 140),
                    "excerpt": excerpt,
                    "url": item.get("doi") or item.get("id") or "https://openalex.org",
                    "verified": True,
                    "addedAt": utc_now_iso(),
                }
            )
        return out
    except Exception:
        return []


async def _search_wikipedia(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    try:
        url = (
            "https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={quote(query)}&utf8=&format=json&srlimit=2"
        )
        resp = await client.get(url, timeout=6.0)
        if resp.status_code != 200:
            return []
        items = ((resp.json().get("query") or {}).get("search")) or []
        return [
            {
                "origin": "Wikipedia",
                "title": clean_text(item.get("title", ""), 120),
                "excerpt": clean_text(_TAG_RE.sub("", item.get("snippet", "")), 240),
                "url": f"https://en.wikipedia.org/?curid={item.get('pageid')}",
                "verified": True,
                "addedAt": utc_now_iso(),
            }
            for item in items
            if item.get("title")
        ]
    except Exception:
        return []


async def search_open_academic_sources(
    query: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=True,
        transport=transport,
    ) as client:
        arxiv, openalex, wiki = await asyncio.gather(
            _search_arxiv(client, query),
            _search_openalex(client, query),
            _search_wikipedia(client, query),
        )
    return (arxiv + openalex + wiki)[:5]


def _extract_pdf_text(raw_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw_bytes))
        chunks = []
        for page in reader.pages[:4]:
            txt = page.extract_text() or ""
            if txt.strip():
                chunks.append(txt.strip())
        return "\n".join(chunks)
    except Exception:
        return ""


async def fetch_url_as_source(
    raw_url: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    resolve_dns: bool = True,
) -> dict[str, Any]:
    if not is_safe_public_url(raw_url, resolve_dns=resolve_dns):
        raise ValueError("URL không hợp lệ hoặc thuộc địa chỉ mạng nội bộ bị chặn.")

    async with httpx.AsyncClient(
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=False,
        timeout=10.0,
        transport=transport,
    ) as client:
        resp = await client.get(raw_url)
        if resp.is_redirect:
            loc = resp.headers.get("location", "")
            if not is_safe_public_url(loc, resolve_dns=resolve_dns):
                raise ValueError("URL chuyển hướng tới địa chỉ không được phép.")
            resp = await client.get(loc)

    if resp.status_code != 200:
        raise RuntimeError(f"Không tải được URL (HTTP {resp.status_code}).")

    raw_bytes = resp.content[:_MAX_FETCH_BYTES]
    ctype = (resp.headers.get("content-type") or "").lower()
    parsed = urlparse(raw_url)
    hostname = (parsed.hostname or "").removeprefix("www.")

    if "application/pdf" in ctype or parsed.path.lower().endswith(".pdf"):
        pdf_text = _extract_pdf_text(raw_bytes)
        title = parsed.path.rsplit("/", 1)[-1] or raw_url
        return {
            "origin": f"PDF · {hostname}",
            "title": clean_text(title, 130),
            "excerpt": clean_text(pdf_text or "Đã đính kèm tài liệu PDF vào kho nguồn.", 360),
            "url": raw_url,
            "verified": True,
            "addedAt": utc_now_iso(),
        }

    html = raw_bytes.decode("utf-8", errors="replace")
    title_match = _TITLE_RE.search(html)
    stripped = _TAG_RE.sub(" ", _SCRIPT_STYLE_RE.sub(" ", html))
    return {
        "origin": f"URL · {hostname}",
        "title": clean_text(title_match.group(1) if title_match else raw_url, 130),
        "excerpt": clean_text(stripped or "Đã đính kèm nội dung trang web vào kho nguồn.", 320),
        "url": raw_url,
        "verified": True,
        "addedAt": utc_now_iso(),
    }
