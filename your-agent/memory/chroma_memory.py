"""Semantic memory via ChromaDB."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from config import CHROMA_PERSIST_PATH

logger = logging.getLogger(__name__)

try:
    import chromadb
    try:
        from chromadb.config import Settings as ChromaSettings
    except ImportError:
        ChromaSettings = None
except ImportError:
    chromadb = None
    ChromaSettings = None


class ChromaMemory:
    COLLECTION = "agent_memories"

    def __init__(self, persist_path: Path | str | None = None):
        self._path = str(persist_path or CHROMA_PERSIST_PATH)
        Path(self._path).mkdir(parents=True, exist_ok=True)
        self._client = None
        self._collection = None
        self._init_client()

    def _init_client(self) -> None:
        if chromadb is None:
            logger.warning("ChromaDB not installed; semantic memory disabled.")
            return
        try:
            if ChromaSettings is not None:
                self._client = chromadb.PersistentClient(
                    path=self._path,
                    settings=ChromaSettings(anonymized_telemetry=False),
                )
            else:
                self._client = chromadb.PersistentClient(path=self._path)
            self._collection = self._client.get_or_create_collection(
                self.COLLECTION,
                metadata={"description": "Agent conversation embeddings"},
            )
        except Exception as e:
            logger.warning("ChromaDB init failed: %s", e)

    def add(self, text: str, metadata: dict[str, Any] | None = None) -> None:
        if self._collection is None:
            return
        try:
            import uuid
            self._collection.add(
                ids=[str(uuid.uuid4())],
                documents=[text],
                metadatas=[metadata or {}],
            )
        except Exception as e:
            logger.warning("ChromaDB add failed: %s", e)

    def search(self, query: str, n_results: int = 5) -> list[str]:
        if self._collection is None:
            return []
        try:
            result = self._collection.query(query_texts=[query], n_results=n_results)
            docs = result.get("documents") or []
            return list(docs[0]) if docs else []
        except Exception as e:
            logger.warning("ChromaDB search failed: %s", e)
            return []

    def get_last(self, limit: int = 20) -> list[dict[str, Any]]:
        """Return last N entries (by id order; Chroma doesn't guarantee order)."""
        if self._collection is None:
            return []
        try:
            data = self._collection.get(limit=limit, include=["documents", "metadatas"])
            docs = data.get("documents") or []
            metas = data.get("metadatas") or []
            return [{"document": d, "metadata": m or {}} for d, m in zip(docs, metas)]
        except Exception as e:
            logger.warning("ChromaDB get_last failed: %s", e)
            return []

    def count(self) -> int:
        if self._collection is None:
            return 0
        try:
            return self._collection.count()
        except Exception as e:
            logger.warning("ChromaDB count failed: %s", e)
            return 0
