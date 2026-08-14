#!/usr/bin/env python3
"""
probe-llm.py — dò các endpoint OpenAI-compatible đang chạy trong mạng nội bộ.

Chỉ GỌI ĐỌC (`GET /v1/models`, `GET /health`, `GET /info`) tới localhost và các
host do người dùng chỉ định. Không gửi dữ liệu đi đâu, không cần API key.

    python3 scripts/probe-llm.py                     # quét localhost các cổng phổ biến
    python3 scripts/probe-llm.py 10.0.0.5            # quét thêm một host
    python3 scripts/probe-llm.py http://10.0.0.5:8001/v1   # kiểm tra đúng 1 URL
"""
from __future__ import annotations

import json
import socket
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# Cổng hay gặp: vLLM, TGI, TEI, llama.cpp, Ollama, LocalAI, Infinity, LM Studio
COMMON_PORTS = [
    8000, 8001, 8002, 8003, 8080, 8081, 8082, 8090,
    9000, 9001, 3000, 5000, 5001, 7860, 7997, 11434, 1234, 4000, 6006,
]
DEFAULT_HOSTS = ["127.0.0.1", "localhost", "host.docker.internal"]
TIMEOUT = 1.5


def port_open(host: str, port: int, timeout: float = 0.35) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def get_json(url: str) -> dict | list | None:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None


def get_text(url: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            return r.read().decode("utf-8", "replace")[:400]
    except Exception:
        return None


def identify(base: str) -> dict | None:
    """Nhận diện một service tại http://host:port."""
    info: dict = {"base": base, "kind": None, "models": [], "notes": []}

    # 1. OpenAI-compatible: /v1/models
    data = get_json(f"{base}/v1/models")
    if isinstance(data, dict) and "data" in data:
        info["kind"] = "openai-compatible"
        info["models"] = [m.get("id") for m in data["data"] if isinstance(m, dict)]
        info["endpoint"] = f"{base}/v1"

    # 2. Ollama: /api/tags
    if info["kind"] is None:
        data = get_json(f"{base}/api/tags")
        if isinstance(data, dict) and "models" in data:
            info["kind"] = "ollama"
            info["models"] = [m.get("name") for m in data["models"]]
            info["endpoint"] = f"{base}/v1"
            info["notes"].append("Ollama có lớp tương thích OpenAI tại /v1")

    # 3. TEI (Text Embeddings Inference): /info
    if info["kind"] is None:
        data = get_json(f"{base}/info")
        if isinstance(data, dict) and ("model_id" in data or "model_type" in data):
            mt = str(data.get("model_type", ""))
            info["kind"] = "tei-reranker" if "rerank" in mt.lower() else "tei-embedding"
            info["models"] = [data.get("model_id", "?")]
            info["endpoint"] = base
            info["notes"].append(f"model_type={mt}")
            info["notes"].append("TEI: dùng POST /embed hoặc /rerank; /v1/embeddings nếu bật")

    # 4. Infinity / LocalAI / khác — thử /docs, /health
    if info["kind"] is None:
        if get_text(f"{base}/docs") or get_text(f"{base}/health"):
            info["kind"] = "http-service (chưa nhận diện được)"
            info["endpoint"] = base
        else:
            return None

    return info


def guess_role(info: dict) -> str:
    """Đoán vai trò: LLM chat / embedding / rerank."""
    kind = info.get("kind") or ""
    ids = " ".join(str(m).lower() for m in info.get("models", []))
    if "rerank" in kind or "rerank" in ids:
        return "RERANK"
    if "embedding" in kind or any(k in ids for k in ("embed", "bge-m3", "gte", "e5")):
        return "EMBEDDING"
    if info.get("kind") in ("openai-compatible", "ollama"):
        return "LLM (chat)"
    return "?"


def main(argv: list[str]) -> int:
    explicit = [a for a in argv if a.startswith("http")]
    hosts = [a for a in argv if not a.startswith("http")] or []
    targets: list[str] = list(explicit)

    scan_hosts = DEFAULT_HOSTS + hosts
    print(f"Quét {len(scan_hosts)} host × {len(COMMON_PORTS)} cổng…")
    with ThreadPoolExecutor(max_workers=64) as ex:
        futs = {
            (h, p): ex.submit(port_open, h, p)
            for h in scan_hosts for p in COMMON_PORTS
        }
        for (h, p), f in futs.items():
            if f.result():
                url = f"http://{h}:{p}"
                if url not in targets:
                    targets.append(url)

    if not targets:
        print("\nKhông thấy cổng nào mở. Hãy chạy lại kèm host, ví dụ:")
        print("    python3 scripts/probe-llm.py 10.0.0.5")
        return 1

    print(f"Cổng mở: {len(targets)} → đang nhận diện…\n")
    found = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        for info in ex.map(identify, targets):
            if info:
                found.append(info)

    if not found:
        print("Có cổng mở nhưng không cái nào giống LLM/embedding server.")
        for t in targets:
            print(f"  {t}")
        return 1

    print("=" * 74)
    for info in sorted(found, key=lambda x: x["base"]):
        role = guess_role(info)
        print(f"\n  {info['base']}")
        print(f"    vai trò đoán : {role}")
        print(f"    loại         : {info['kind']}")
        print(f"    endpoint     : {info.get('endpoint', info['base'])}")
        if info["models"]:
            for m in info["models"][:8]:
                print(f"    model        : {m}")
        for n in info["notes"]:
            print(f"    ghi chú      : {n}")
    print("\n" + "=" * 74)

    print("\nGợi ý biến môi trường cho backend/.env:")
    for info in found:
        role = guess_role(info)
        ep = info.get("endpoint", info["base"])
        model = info["models"][0] if info["models"] else "<tên-model>"
        if role.startswith("LLM"):
            print(f"  LLM_BASE_URL={ep}\n  LLM_MODEL={model}")
        elif role == "EMBEDDING":
            print(f"  EMBED_BASE_URL={ep}\n  EMBED_MODEL={model}")
        elif role == "RERANK":
            print(f"  RERANK_BASE_URL={ep}\n  RERANK_MODEL={model}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
