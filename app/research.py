"""Bộ tìm kiếm tài liệu học thuật mở (arXiv, OpenAlex, Wikipedia), tải URL/PDF đa chặng (chống SSRF) và nạp PDF cục bộ.
- Tự động nâng cấp bài báo mở (arXiv / OpenAlex OA) lên toàn văn PDF (tối đa 20 trang, 16.000 ký tự).
- Gắn nhãn mức độ nguồn contentLevel: 'full_text' | 'abstract_only' | 'excerpt' để UI và Trọng tài nhận biết trung thực.
"""

from __future__ import annotations

import asyncio
import io
import ipaddress
import re
import socket
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlparse

import httpx

from app.storage import utc_now_iso

_USER_AGENT = "ResearchLab/2.0 (Academic Open Search; local)"
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>[\s\S]*?</\1>", re.IGNORECASE)
_TITLE_RE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.IGNORECASE)
_WS_RE = re.compile(r"\s+")
_MAX_FETCH_BYTES = 15 * 1024 * 1024  # 15 MB cap cho tài liệu PDF khoa học
_MAX_REDIRECT_HOPS = 5
MAX_SOURCE_EXCERPT_LEN = 2400
MAX_FULLTEXT_EXCERPT_LEN = 16000
MAX_FETCH_SOURCE_EXCERPT_LEN = MAX_FULLTEXT_EXCERPT_LEN

_VI_FILLER_PHRASES = (
    "deep research:",
    "hãy nghiên cứu về",
    "nghiên cứu về",
    "tìm tài liệu về",
    "tìm hiểu về",
    "dựa trên các nguồn",
    "cho ví dụ với là về",
    "cho ví dụ về",
    "chủ đề nghiên cứu là",
    "chủ đề là",
    "hãy phân tích chi tiết về",
    "hãy phân tích về",
    "phân tích chi tiết về",
    "chi tiết về",
    "giúp tôi",
    "vui lòng",
)
_QUERY_STOPWORDS = {
    "the", "and", "for", "with", "from", "into", "that", "this", "about", "how",
    "what", "when", "where", "which", "deep", "research", "study", "analysis",
    "của", "các", "cách", "những", "cho", "với", "trong", "trên", "này", "kia",
    "mới", "hãy", "về", "tìm", "hiểu", "nghiên", "cứu", "phân", "tích", "tài",
    "liệu", "ví", "dụ", "là", "để", "như", "thế", "nào", "và",
}
_VI_ACADEMIC_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("thị trường", "trading", "giao dịch"), "financial market algorithmic trading"),
    (("bắt thông tin", "tin tức", "tín hiệu"), "market news sentiment signal detection"),
    (("fintech", "tài chính"), "fintech financial technology"),
    (("chứng khoán", "cổ phiếu"), "stock market quantitative finance"),
    (("tiền điện tử", "crypto", "blockchain"), "cryptocurrency blockchain"),
    (("trí tuệ nhân tạo", "ai", "llm"), "large language model artificial intelligence"),
    (("y tế", "bệnh viện", "chẩn đoán"), "medical healthcare clinical diagnosis"),
    (("giáo dục", "sinh viên", "học tập"), "education university learning"),
)


def normalize_academic_query(raw_query: str) -> str:
    """Làm sạch câu lệnh hội thoại tiếng Việt và bổ sung từ khóa học thuật chuẩn để tìm đúng nguồn."""
    cleaned = _WS_RE.sub(" ", str(raw_query or "")).strip()
    changed = True
    while changed:
        changed = False
        low = cleaned.lower()
        for phrase in _VI_FILLER_PHRASES:
            if low.startswith(phrase):
                cleaned = cleaned[len(phrase) :].strip(" :,-.")
                changed = True
                break

    tokens = re.findall(r"[^\W_]+", cleaned, flags=re.UNICODE)
    core_tokens = [t for t in tokens if len(t) >= 2 and t.lower() not in _QUERY_STOPWORDS][:8]
    base_query = " ".join(core_tokens) if core_tokens else cleaned

    hints: list[str] = []
    full_low = (cleaned + " " + base_query).lower()
    for triggers, expansion in _VI_ACADEMIC_HINTS:
        if any(tr in full_low for tr in triggers):
            for word in expansion.split():
                if word.lower() not in full_low and word.lower() not in " ".join(hints).lower():
                    hints.append(word)

    if hints:
        ascii_or_keep = [
            t for t in core_tokens if all(ord(ch) < 128 for ch in t) or len(core_tokens) <= 4
        ]
        combined = " ".join(ascii_or_keep[:6] + hints[:6]).strip()
        return combined or base_query
    return base_query or cleaned


def _score_source_relevance(query: str, title: str, excerpt: str) -> int:
    raw_terms = re.findall(r"[^\W_]+", f"{query} {normalize_academic_query(query)}", flags=re.UNICODE)
    terms = {t.lower() for t in raw_terms if len(t) >= 3 and t.lower() not in _QUERY_STOPWORDS}
    if not terms:
        return 1
    title_low = (title or "").lower()
    excerpt_low = (excerpt or "").lower()
    score = 0
    for term in terms:
        if term in title_low:
            score += 3
        elif term in excerpt_low:
            score += 1
    return score


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


async def _safe_get_following_redirects(
    client: httpx.AsyncClient,
    start_url: str,
    *,
    resolve_dns: bool = True,
    max_hops: int = _MAX_REDIRECT_HOPS,
    timeout: float = 12.0,
) -> tuple[httpx.Response, str]:
    """Tải URL theo chuỗi chuyển hướng (DOI/arXiv/CDN) tối đa max_hops chặng, kiểm tra SSRF ở TỪNG chặng."""
    current_url = start_url
    for hop in range(max_hops + 1):
        if not is_safe_public_url(current_url, resolve_dns=resolve_dns):
            raise ValueError(
                "URL không hợp lệ hoặc thuộc địa chỉ mạng nội bộ bị chặn."
                if hop == 0
                else "URL chuyển hướng tới địa chỉ không được phép."
            )
        resp = await client.get(current_url, follow_redirects=False, timeout=timeout)
        if not resp.is_redirect:
            return resp, current_url
        raw_loc = (resp.headers.get("location") or "").strip()
        if not raw_loc:
            return resp, current_url
        current_url = urljoin(current_url, raw_loc)

    raise RuntimeError(f"URL chuyển hướng quá {max_hops} chặng.")


def _extract_arxiv_pdf_url(entry: ET.Element, ns: dict[str, str], entry_url: str) -> str:
    for link in entry.findall("atom:link", ns):
        href = (link.attrib.get("href") or "").strip()
        title_attr = (link.attrib.get("title") or "").strip().lower()
        type_attr = (link.attrib.get("type") or "").strip().lower()
        if href and (title_attr == "pdf" or type_attr == "application/pdf"):
            return href
    if "/abs/" in entry_url:
        paper_id = entry_url.rsplit("/abs/", 1)[-1].split("?")[0].strip("/")
        if paper_id:
            return f"https://arxiv.org/pdf/{paper_id}.pdf"
    return ""


async def _search_arxiv(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    try:
        clean_q = normalize_academic_query(query) or query
        url = f"https://export.arxiv.org/api/query?search_query=all:{quote(clean_q)}&start=0&max_results=3"
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
            entry_url = (id_el.text or "").strip()
            year = (pub_el.text or "")[:4] if pub_el is not None else "Recent"
            excerpt = clean_text(
                (summary_el.text if summary_el is not None else "") or "Tài liệu nghiên cứu trên arXiv.",
                MAX_SOURCE_EXCERPT_LEN,
            )
            pdf_url = _extract_arxiv_pdf_url(entry, ns, entry_url)
            out.append(
                {
                    "origin": f"arXiv · {year or 'Recent'}",
                    "title": clean_text(title_el.text or "", 180),
                    "excerpt": excerpt,
                    "url": entry_url,
                    "contentLevel": "abstract_only",
                    "charCount": len(excerpt),
                    "verified": True,
                    "addedAt": utc_now_iso(),
                    "_pdf_url": pdf_url,
                }
            )
        return out
    except Exception:
        return []


async def _search_openalex(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    try:
        clean_q = normalize_academic_query(query) or query
        url = f"https://api.openalex.org/works?search={quote(clean_q)}&per-page=3"
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
                    words = [""] * (min(max_pos, 800) + 1)
                    for word, positions in inv.items():
                        for pos in positions:
                            if 0 <= pos < len(words):
                                words[pos] = word
                    reconstructed = " ".join(w for w in words if w)
                    if reconstructed:
                        excerpt = clean_text(reconstructed, MAX_SOURCE_EXCERPT_LEN)
            best_oa = item.get("best_oa_location") or {}
            oa_info = item.get("open_access") or {}
            pdf_url = str(best_oa.get("pdf_url") or "").strip()
            if not pdf_url:
                candidate_oa = str(oa_info.get("oa_url") or "").strip()
                if candidate_oa.lower().endswith(".pdf") or "/pdf" in candidate_oa.lower():
                    pdf_url = candidate_oa
            out.append(
                {
                    "origin": f"OpenAlex · {item.get('publication_year') or 'Recent'}",
                    "title": clean_text(title, 180),
                    "excerpt": excerpt,
                    "url": item.get("doi") or item.get("id") or "https://openalex.org",
                    "contentLevel": "abstract_only",
                    "charCount": len(excerpt),
                    "verified": True,
                    "addedAt": utc_now_iso(),
                    "_pdf_url": pdf_url,
                }
            )
        return out
    except Exception:
        return []


async def _search_wikipedia_lang(client: httpx.AsyncClient, query: str, lang: str) -> list[dict[str, Any]]:
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=query&generator=search"
            f"&gsrsearch={quote(query)}&gsrlimit=2&prop=extracts|info"
            "&exintro=1&explaintext=1&exchars=2400&inprop=url&utf8=1&format=json"
        )
        resp = await client.get(url, timeout=6.0)
        if resp.status_code != 200:
            return []
        query_block = resp.json().get("query") or {}
        pages = query_block.get("pages")
        if isinstance(pages, dict) and pages:
            ordered = sorted(pages.values(), key=lambda p: int(p.get("index", 99)))
            out: list[dict[str, Any]] = []
            for item in ordered:
                title = item.get("title") or ""
                if not title:
                    continue
                extract = item.get("extract") or ""
                pageid = item.get("pageid")
                fullurl = item.get("fullurl") or f"https://{lang}.wikipedia.org/?curid={pageid}"
                cleaned_excerpt = clean_text(extract or "Bài tổng quan từ Wikipedia.", MAX_SOURCE_EXCERPT_LEN)
                out.append(
                    {
                        "origin": f"Wikipedia ({lang})",
                        "title": clean_text(title, 160),
                        "excerpt": cleaned_excerpt,
                        "url": fullurl,
                        "contentLevel": "excerpt",
                        "charCount": len(cleaned_excerpt),
                        "verified": True,
                        "addedAt": utc_now_iso(),
                    }
                )
            return out

        items = query_block.get("search") or []
        out_fallback: list[dict[str, Any]] = []
        for item in items:
            if not item.get("title"):
                continue
            cleaned_excerpt = clean_text(_TAG_RE.sub("", item.get("snippet", "")), MAX_SOURCE_EXCERPT_LEN)
            out_fallback.append(
                {
                    "origin": f"Wikipedia ({lang})",
                    "title": clean_text(item.get("title", ""), 160),
                    "excerpt": cleaned_excerpt,
                    "url": f"https://{lang}.wikipedia.org/?curid={item.get('pageid')}",
                    "contentLevel": "excerpt",
                    "charCount": len(cleaned_excerpt),
                    "verified": True,
                    "addedAt": utc_now_iso(),
                }
            )
        return out_fallback
    except Exception:
        return []


async def _search_wikipedia(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    clean_q = normalize_academic_query(query) or query
    vi_items, en_items = await asyncio.gather(
        _search_wikipedia_lang(client, query, "vi"),
        _search_wikipedia_lang(client, clean_q, "en"),
    )
    return vi_items + en_items


def _extract_pdf_text(raw_bytes: bytes, max_pages: int = 20) -> tuple[str, int]:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw_bytes))
        total_pages = len(reader.pages)
        chunks = []
        for page in reader.pages[:max_pages]:
            txt = page.extract_text() or ""
            if txt.strip():
                chunks.append(txt.strip())
        return "\n".join(chunks), total_pages
    except Exception:
        return "", 0


async def _upgrade_item_to_fulltext(
    client: httpx.AsyncClient,
    item: dict[str, Any],
    *,
    resolve_dns: bool = True,
) -> None:
    """Thử nâng cấp bài báo mở (arXiv/OA) từ tóm tắt lên toàn văn PDF; lỗi/404 giữ nguyên abstract."""
    pdf_url = str(item.get("_pdf_url") or "").strip()
    if not pdf_url:
        return
    try:
        resp, _final_url = await _safe_get_following_redirects(
            client, pdf_url, resolve_dns=resolve_dns, timeout=10.0
        )
        if resp.status_code != 200:
            return
        raw_bytes = resp.content[:_MAX_FETCH_BYTES]
        ctype = (resp.headers.get("content-type") or "").lower()
        is_pdf = ("application/pdf" in ctype) or (b"%PDF-" in raw_bytes[:1024])
        if not is_pdf:
            return
        pdf_text, pages = _extract_pdf_text(raw_bytes, max_pages=20)
        if len(pdf_text.strip()) <= max(len(str(item.get("excerpt") or "")), 400):
            return
        full_excerpt = clean_text(pdf_text, MAX_FULLTEXT_EXCERPT_LEN)
        item["excerpt"] = full_excerpt
        item["contentLevel"] = "full_text"
        item["charCount"] = len(full_excerpt)
        orig = str(item.get("origin") or "PDF")
        if "Toàn văn PDF" not in orig:
            item["origin"] = f"{orig} · Toàn văn PDF" + (f" ({pages} tr)" if pages > 0 else "")
    except Exception:
        return


async def search_open_academic_sources(
    query: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    upgrade_fulltext: bool = True,
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
        combined = arxiv + openalex + wiki
        scored = [
            (_score_source_relevance(query, str(item.get("title", "")), str(item.get("excerpt", ""))), idx, item)
            for idx, item in enumerate(combined)
        ]
        positive = [row for row in scored if row[0] > 0]
        chosen = positive if positive else scored
        chosen.sort(key=lambda r: (-r[0], r[1]))
        seen_urls: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for _score, _idx, item in chosen:
            u = str(item.get("url") or "").strip().lower()
            if u and u in seen_urls:
                continue
            if u:
                seen_urls.add(u)
            deduped.append(item)
            if len(deduped) >= 6:
                break

        if upgrade_fulltext and deduped:
            pdf_candidates = [item for item in deduped if item.get("_pdf_url")][:3]
            if pdf_candidates:
                await asyncio.gather(
                    *(
                        _upgrade_item_to_fulltext(client, it, resolve_dns=(transport is None))
                        for it in pdf_candidates
                    )
                )

    for item in deduped:
        item.pop("_pdf_url", None)
    return deduped


def extract_uploaded_pdf_source(raw_bytes: bytes, filename: str = "tai-lieu.pdf") -> dict[str, Any]:
    """Trích xuất toàn văn từ tệp PDF người dùng tải lên trực tiếp từ máy tính."""
    if not raw_bytes:
        raise ValueError("Tệp PDF tải lên đang trống.")
    if len(raw_bytes) > _MAX_FETCH_BYTES:
        raise ValueError("Tệp PDF vượt quá giới hạn dung lượng 15 MB.")
    if b"%PDF-" not in raw_bytes[:1024]:
        raise ValueError("Tệp tải lên không đúng định dạng PDF (%PDF-).")

    pdf_text, page_count = _extract_pdf_text(raw_bytes, max_pages=25)
    if not pdf_text.strip():
        raise ValueError(
            "PDF này là bản quét hình ảnh (chưa có lớp văn bản OCR) nên chưa thể trích xuất chữ tự động."
        )

    base_name = Path(str(filename or "tai-lieu.pdf").strip()).name or "tai-lieu.pdf"
    safe_name = re.sub(r"[^a-zA-Z0-9._\-\u00C0-\u1EF9 ]+", "_", base_name).strip() or "tai-lieu.pdf"
    excerpt = clean_text(pdf_text, MAX_FULLTEXT_EXCERPT_LEN)
    page_note = f"{page_count} trang" if page_count > 0 else "PDF"
    return {
        "origin": f"PDF tải lên · {page_note}",
        "title": clean_text(safe_name, 160),
        "excerpt": excerpt,
        "url": f"#local-pdf:{quote(safe_name)}",
        "contentLevel": "full_text",
        "charCount": len(excerpt),
        "verified": True,
        "addedAt": utc_now_iso(),
    }


async def fetch_url_as_source(
    raw_url: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    resolve_dns: bool = True,
) -> dict[str, Any]:
    async with httpx.AsyncClient(
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=False,
        timeout=12.0,
        transport=transport,
    ) as client:
        resp, final_url = await _safe_get_following_redirects(
            client, raw_url, resolve_dns=resolve_dns
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Không tải được URL (HTTP {resp.status_code}).")

    raw_bytes = resp.content[:_MAX_FETCH_BYTES]
    ctype = (resp.headers.get("content-type") or "").lower()
    parsed = urlparse(final_url)
    hostname = (parsed.hostname or "").removeprefix("www.")

    if "application/pdf" in ctype or parsed.path.lower().endswith(".pdf") or (b"%PDF-" in raw_bytes[:1024]):
        pdf_text, page_count = _extract_pdf_text(raw_bytes, max_pages=20)
        title = parsed.path.rsplit("/", 1)[-1] or final_url
        excerpt = clean_text(pdf_text or "Đã đính kèm tài liệu PDF vào kho nguồn.", MAX_FULLTEXT_EXCERPT_LEN)
        content_level = "full_text" if pdf_text.strip() else "excerpt"
        origin_suffix = f" ({page_count} tr)" if page_count > 0 else ""
        return {
            "origin": f"PDF · {hostname}{origin_suffix}",
            "title": clean_text(title, 160),
            "excerpt": excerpt,
            "url": final_url,
            "contentLevel": content_level,
            "charCount": len(excerpt),
            "verified": True,
            "addedAt": utc_now_iso(),
        }

    html = raw_bytes.decode("utf-8", errors="replace")
    title_match = _TITLE_RE.search(html)
    stripped = _TAG_RE.sub(" ", _SCRIPT_STYLE_RE.sub(" ", html))
    excerpt = clean_text(stripped or "Đã đính kèm nội dung trang web vào kho nguồn.", MAX_FULLTEXT_EXCERPT_LEN)
    return {
        "origin": f"URL · {hostname}",
        "title": clean_text(title_match.group(1) if title_match else final_url, 160),
        "excerpt": excerpt,
        "url": final_url,
        "contentLevel": "full_text" if len(excerpt) >= 2500 else "excerpt",
        "charCount": len(excerpt),
        "verified": True,
        "addedAt": utc_now_iso(),
    }
