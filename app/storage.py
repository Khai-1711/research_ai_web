"""Lưu trữ phòng chat trên đĩa (webchat/data/rooms/<room_id>/: meta.json, sources.json, events.jsonl) và phát SSE (/flow).
- Sửa file này khi muốn thay đổi cấu trúc lưu trữ phòng chat hoặc sự kiện hiển thị trên sơ đồ /flow.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

_SAFE_ID_RE = re.compile(r"[^a-zA-Z0-9_-]")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def safe_room_id(room_id: str) -> str:
    clean = _SAFE_ID_RE.sub("", str(room_id or ""))
    if not clean:
        raise ValueError("Invalid room ID")
    return clean


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_name = tmp.name
            json.dump(data, tmp, ensure_ascii=False, indent=2)
            tmp.flush()
        os.replace(tmp_name, path)
        tmp_name = None
    finally:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


class RoomStorage:
    """Manages persistent rooms, append-only JSONL flow events, and live SSE queues."""

    def __init__(self, data_dir: Path, default_model: str = "gemini-4-hydrogen") -> None:
        self.data_dir = Path(data_dir)
        self.default_model = default_model or "gemini-4-hydrogen"
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _room_dir(self, room_id: str) -> Path:
        return self.data_dir / safe_room_id(room_id)

    def ensure_default_room(self) -> None:
        """Create a single clean empty room ONLY if no rooms exist on disk."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        has_any = any((entry / "meta.json").exists() for entry in self.data_dir.iterdir() if entry.is_dir())
        if has_any:
            return
        now = utc_now_iso()
        self.save_room(
            {
                "id": "room-default",
                "title": "Phòng nghiên cứu mới",
                "topicPrompt": "",
                "createdAt": now,
                "updatedAt": now,
                "perspectives": [
                    {
                        "id": "p-research-1",
                        "handle": "Nghiên_cứu",
                        "name": "Chuyên gia Nghiên cứu (Đọc nguồn & Phân tích)",
                        "rolePrompt": (
                            "Bạn là chuyên gia nghiên cứu học thuật. Đọc kỹ nguồn tài liệu, "
                            "phân tích sâu, cấu trúc rõ ràng, trích dẫn [S#] khi có dữ liệu "
                            'và mở đầu bằng dòng "Kết luận: ...".'
                        ),
                        "tags": ["Nghiên_cứu"],
                        "modelLabel": self.default_model,
                        "providerId": "bridge-local",
                        "colorIndex": 0,
                        "enabled": True,
                    }
                ],
                "messages": [],
                "sources": [],
                "livingOutline": {"consensus": [], "contradictions": [], "gaps": []},
                "audit": [],
            }
        )

    def save_room(self, room: dict[str, Any]) -> dict[str, Any]:
        room_dir = self._room_dir(room["id"])
        room_dir.mkdir(parents=True, exist_ok=True)
        sources = list(room.get("sources") or [])
        meta = {k: v for k, v in room.items() if k != "sources"}
        _atomic_write_json(room_dir / "meta.json", meta)
        _atomic_write_json(room_dir / "sources.json", sources)
        events_path = room_dir / "events.jsonl"
        if not events_path.exists():
            events_path.write_text("", encoding="utf-8")
        return room

    def get_room(self, room_id: str) -> dict[str, Any] | None:
        try:
            room_dir = self._room_dir(room_id)
            meta_path = room_dir / "meta.json"
            if not meta_path.exists():
                return None
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            sources_path = room_dir / "sources.json"
            sources = (
                json.loads(sources_path.read_text(encoding="utf-8"))
                if sources_path.exists()
                else []
            )
            meta["sources"] = sources
            return meta
        except (ValueError, OSError, json.JSONDecodeError):
            return None

    def list_full_rooms(self) -> list[dict[str, Any]]:
        self.ensure_default_room()
        rooms: list[dict[str, Any]] = []
        for entry in self.data_dir.iterdir():
            if entry.is_dir():
                room = self.get_room(entry.name)
                if room is not None:
                    rooms.append(room)
        rooms.sort(key=lambda r: str(r.get("updatedAt") or ""), reverse=True)
        return rooms

    def list_room_summaries(self) -> list[dict[str, Any]]:
        summaries: list[dict[str, Any]] = []
        for r in self.list_full_rooms():
            persp = r.get("perspectives") or []
            summaries.append(
                {
                    "id": r["id"],
                    "title": r.get("title", ""),
                    "totalPerspectives": len(persp),
                    "enabledPerspectives": sum(1 for p in persp if p.get("enabled", True)),
                    "sourceCount": len(r.get("sources") or []),
                    "messageCount": len(r.get("messages") or []),
                    "updatedAt": r.get("updatedAt", ""),
                }
            )
        return summaries

    def delete_room(self, room_id: str) -> bool:
        try:
            room_dir = self._room_dir(room_id)
        except ValueError:
            return False
        if not room_dir.exists():
            return False
        shutil.rmtree(room_dir, ignore_errors=True)
        return True

    def write_flow_events(self, room_id: str, events: list[dict[str, Any]]) -> None:
        room_dir = self._room_dir(room_id)
        room_dir.mkdir(parents=True, exist_ok=True)
        text = "\n".join(json.dumps(e, ensure_ascii=False) for e in events)
        if text:
            text += "\n"
        (room_dir / "events.jsonl").write_text(text, encoding="utf-8")

    def get_flow_events(self, room_id: str) -> list[dict[str, Any]]:
        try:
            events_path = self._room_dir(room_id) / "events.jsonl"
            if not events_path.exists():
                return []
            out: list[dict[str, Any]] = []
            for line in events_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    out.append(json.loads(line))
            return out
        except (ValueError, OSError, json.JSONDecodeError):
            return []

    def get_raw_events_jsonl(self, room_id: str) -> str:
        try:
            events_path = self._room_dir(room_id) / "events.jsonl"
            return events_path.read_text(encoding="utf-8") if events_path.exists() else ""
        except (ValueError, OSError):
            return ""

    def append_flow_event(self, room_id: str, event_without_seq: dict[str, Any]) -> dict[str, Any]:
        key = safe_room_id(room_id)
        room_dir = self._room_dir(key)
        room_dir.mkdir(parents=True, exist_ok=True)
        existing = self.get_flow_events(key)
        next_seq = int(existing[-1].get("seq", 0)) + 1 if existing else 1
        full_event = {
            **event_without_seq,
            "room_id": key,
            "seq": next_seq,
            "timestamp": event_without_seq.get("timestamp") or utc_now_iso(),
        }
        with (room_dir / "events.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(full_event, ensure_ascii=False) + "\n")
            f.flush()

        for q in list(self._subscribers.get(key, ())):
            try:
                q.put_nowait(full_event)
            except asyncio.QueueFull:
                pass
        return full_event

    def subscribe(self, room_id: str) -> tuple[asyncio.Queue[dict[str, Any]], Callable[[], None]]:
        key = safe_room_id(room_id)
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self._subscribers.setdefault(key, set()).add(q)

        def _unsubscribe() -> None:
            subs = self._subscribers.get(key)
            if subs:
                subs.discard(q)
                if not subs:
                    self._subscribers.pop(key, None)

        return q, _unsubscribe
