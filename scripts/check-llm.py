#!/usr/bin/env python3
"""
check-llm.py — kiểm chứng 3 endpoint model đang dùng cho AI Legal.

Đọc cấu hình từ biến môi trường, mặc định theo thông tin đã được cung cấp:
    LLM_BASE_URL    http://171.244.136.217:8386/v1
    EMBED_BASE_URL  http://171.244.136.217:8387
    RERANK_BASE_URL http://171.244.136.217:8389

    python3 scripts/check-llm.py            # kiểm tra đủ 3
    python3 scripts/check-llm.py llm        # chỉ LLM
    python3 scripts/check-llm.py json       # thử guided JSON output
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

HOST = os.environ.get("MODEL_HOST", "171.244.136.217")
LLM_BASE = os.environ.get("LLM_BASE_URL", f"http://{HOST}:8386/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen3.6-27B")
LLM_KEY = os.environ.get("LLM_API_KEY", "EMPTY")
EMBED_BASE = os.environ.get("EMBED_BASE_URL", f"http://{HOST}:8387")
RERANK_BASE = os.environ.get("RERANK_BASE_URL", f"http://{HOST}:8389")

TIMEOUT = 120


def post(url: str, payload: dict, auth: str | None = None) -> tuple[int, object, float]:
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = f"Bearer {auth}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, json.loads(r.read().decode()), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500], time.time() - t0


def get(url: str, auth: str | None = None) -> tuple[int, object, float]:
    headers = {}
    if auth:
        headers["Authorization"] = f"Bearer {auth}"
    req = urllib.request.Request(url, headers=headers)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            try:
                return r.status, json.loads(raw), time.time() - t0
            except json.JSONDecodeError:
                return r.status, raw[:300], time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300], time.time() - t0


def ok(msg: str) -> None:
    print(f"  \033[32mOK\033[0m   {msg}")


def bad(msg: str) -> None:
    print(f"  \033[31mLỖI\033[0m  {msg}")


# ─────────────────────────────────────────────────────────────────────────────
def check_llm() -> bool:
    print(f"\n[1] LLM  {LLM_BASE}  model={LLM_MODEL}")
    good = True

    st, data, dt = get(f"{LLM_BASE}/models", LLM_KEY)
    if st == 200 and isinstance(data, dict):
        ids = [m.get("id") for m in data.get("data", [])]
        ok(f"GET /models ({dt:.2f}s) → {ids}")
        if LLM_MODEL not in ids:
            bad(f"model '{LLM_MODEL}' KHÔNG có trong danh sách — sẽ lỗi khi gọi")
            good = False
    else:
        bad(f"GET /models → HTTP {st}: {str(data)[:200]}")
        good = False

    # Chat cơ bản. enable_thinking=false là BẮT BUỘC với Qwen3.
    st, data, dt = post(f"{LLM_BASE}/chat/completions", {
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": "Trả lời đúng hai chữ: xin chào"}],
        "chat_template_kwargs": {"enable_thinking": False},
        "temperature": 0, "max_tokens": 32,
    }, LLM_KEY)
    if st == 200:
        msg = data["choices"][0]["message"]["content"]
        u = data.get("usage", {})
        ok(f"chat ({dt:.2f}s, in={u.get('prompt_tokens')} out={u.get('completion_tokens')}) → {msg!r}")
        if "<think" in msg:
            bad("output còn thẻ <think> — enable_thinking chưa tắt được")
            good = False
    else:
        bad(f"chat → HTTP {st}: {str(data)[:300]}")
        good = False

    return good


def check_guided_json() -> bool:
    """Guided decoding là nền tảng của Stage 2 — phải xác minh trước khi thiết kế."""
    print(f"\n[1b] LLM — guided JSON (bắt buộc cho Stage 2)")
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["clause_code", "verdict", "self_confidence"],
        "properties": {
            "clause_code": {"type": "string"},
            "verdict": {"type": "string",
                        "enum": ["ideal_met", "fallback_met", "below_fallback",
                                 "red_line_violation", "missing", "not_applicable"]},
            "self_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
    }
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "Bạn rà soát điều khoản hợp đồng. Chỉ trả JSON."},
            {"role": "user", "content":
                "Điều khoản PAY-001 yêu cầu thanh toán trong 30 ngày. "
                "Hợp đồng ghi: 'Bên Mua thanh toán trong vòng 45 ngày'. Đánh giá."},
        ],
        "chat_template_kwargs": {"enable_thinking": False},
        "temperature": 0, "max_tokens": 200,
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": "verdict", "schema": schema}},
    }
    st, data, dt = post(f"{LLM_BASE}/chat/completions", payload, LLM_KEY)
    if st != 200:
        bad(f"response_format=json_schema → HTTP {st}: {str(data)[:300]}")
        print("       → thử fallback 'guided_json' (vLLM cũ)")
        payload.pop("response_format")
        payload["guided_json"] = schema
        st, data, dt = post(f"{LLM_BASE}/chat/completions", payload, LLM_KEY)
        if st != 200:
            bad(f"guided_json → HTTP {st}: {str(data)[:300]}")
            return False
        ok("guided_json (kiểu vLLM cũ) chạy được")
    content = data["choices"][0]["message"]["content"]
    try:
        parsed = json.loads(content)
        ok(f"JSON hợp lệ ({dt:.2f}s) → {parsed}")
        return True
    except json.JSONDecodeError:
        bad(f"KHÔNG parse được JSON: {content[:200]!r}")
        return False


def check_embed() -> bool:
    print(f"\n[2] Embedding (TEI)  {EMBED_BASE}")
    good = True
    st, data, dt = get(f"{EMBED_BASE}/health")
    ok(f"GET /health → HTTP {st}") if st == 200 else bad(f"GET /health → HTTP {st}")

    st, data, dt = get(f"{EMBED_BASE}/info")
    if st == 200 and isinstance(data, dict):
        ok(f"model_id={data.get('model_id')} max_input={data.get('max_input_length')} "
           f"type={data.get('model_type')}")

    st, data, dt = post(f"{EMBED_BASE}/embed",
                        {"inputs": ["phương thức thanh toán", "điều khoản bảo hành"]})
    if st == 200 and isinstance(data, list):
        ok(f"POST /embed ({dt:.2f}s) → {len(data)} vector, dim={len(data[0])}")
    else:
        bad(f"POST /embed → HTTP {st}: {str(data)[:200]}")
        good = False

    # TEI đôi khi bật thêm route OpenAI — kiểm tra để biết có dùng được không
    st, _, _ = post(f"{EMBED_BASE}/v1/embeddings",
                    {"input": ["thử"], "model": "tei"})
    print(f"       /v1/embeddings (OpenAI-style): {'có' if st == 200 else f'không (HTTP {st})'}")
    return good


def check_rerank() -> bool:
    print(f"\n[3] Rerank (TEI)  {RERANK_BASE}")
    st, data, dt = post(f"{RERANK_BASE}/rerank", {
        "query": "thời hạn thanh toán",
        "texts": [
            "Bên Mua thanh toán trong vòng 30 ngày kể từ ngày nhận hóa đơn.",
            "Hàng hóa được bảo hành 12 tháng kể từ ngày giao.",
            "Địa điểm giao hàng theo thông báo của Bên Mua.",
        ],
        "truncate": True,
    })
    if st == 200 and isinstance(data, list):
        ok(f"POST /rerank ({dt:.2f}s) → {len(data)} kết quả")
        for r in data:
            print(f"       index={r.get('index')} score={r.get('score'):.4f}")
        top = max(data, key=lambda x: x["score"])
        if top["index"] == 0:
            ok("xếp hạng đúng — đoạn về thanh toán đứng đầu")
        else:
            bad(f"xếp hạng đáng ngờ — index {top['index']} đứng đầu, kỳ vọng 0")
        return True
    bad(f"POST /rerank → HTTP {st}: {str(data)[:200]}")
    return False


def main(argv: list[str]) -> int:
    which = set(argv) or {"llm", "json", "embed", "rerank"}
    print("=" * 70)
    print("KIỂM CHỨNG ENDPOINT MODEL — AI Legal")
    print("=" * 70)
    results = {}
    if "llm" in which:
        results["LLM chat"] = check_llm()
    if "json" in which or "llm" in which:
        results["Guided JSON"] = check_guided_json()
    if "embed" in which:
        results["Embedding"] = check_embed()
    if "rerank" in which:
        results["Rerank"] = check_rerank()

    print("\n" + "=" * 70)
    for k, v in results.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    print("=" * 70)
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main([a for a in sys.argv[1:]]))
