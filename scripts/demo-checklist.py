#!/usr/bin/env python3
"""
Nạp checklist MẪU vào hệ thống để chạy thử luồng AI review.

    python3 scripts/demo-checklist.py            # xem sẽ nạp gì
    python3 scripts/demo-checklist.py --yes      # nạp thật

⚠️  Nội dung điều khoản nằm ở `scripts/demo-checklist.json`, **không nằm trong
    code** — đó là chủ ý: nội dung pháp lý thuộc Legal, code không được giữ
    (bất biến B3). File JSON đó là hàng mẫu do dev soạn, CHƯA qua Legal, và
    phải bị thay trước khi dùng cho bất kỳ quyết định nghiệp vụ nào.

Nạp qua đúng API mà màn Configurations gọi, nên kết quả giống hệt việc Legal
ngồi gõ trên UI — kể cả vết audit.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:8000/api/v1"
DATA = Path(__file__).with_name("demo-checklist.json")


def call(method: str, path: str, token: str | None = None, data: dict | None = None):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, body) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main() -> int:
    spec = json.loads(DATA.read_text(encoding="utf-8"))
    parent, child = spec["parent"], spec["child"]

    print("⚠️ ", spec["_canh_bao"])
    print()
    print(f"Lớp CHA  · loại HĐ {parent['categorySlug']}  · {len(parent['clauses'])} điều khoản")
    for c in parent["clauses"]:
        print(f"   {c['code']}  {c['kind']:<12}{c['severity']:<11}{c['name']}")
    print(f"\nLớp CON  · tên HĐ {child['contractNameSlug']}  · {len(child['clauses'])} điều khoản")
    for c in child["clauses"]:
        print(f"   {c['code']}  {c['kind']:<12}{c['severity']:<11}{c['name']}")

    if "--yes" not in sys.argv:
        print("\nChạy lại với --yes để nạp thật.")
        return 0

    status, session = call(
        "POST", "/auth/login", data={"username": "legal", "password": "demo123"}
    )
    if status != 200:
        print(f"\n✗ Không đăng nhập được tài khoản legal: {status} {session}")
        return 1
    token = session["token"]

    print()
    for layer, path, clauses in (
        ("CHA", f"/config/parent-categories/{parent['categorySlug']}/ensure", parent["clauses"]),
        ("CON", f"/config/contract-names/{child['contractNameSlug']}/ensure", child["clauses"]),
    ):
        status, config = call("POST", path, token)
        if status != 200:
            print(f"✗ tạo cấu hình lớp {layer}: {status} {config}")
            return 1
        status, saved = call(
            "PUT", f"/config/versions/{config['id']}", token, {"clauses": clauses}
        )
        if status != 200:
            print(f"✗ lưu điều khoản lớp {layer}: {status} {saved}")
            return 1
        print(f"✓ lớp {layer}: {len(saved['clauses'])} điều khoản")

    status, merged = call("GET", f"/config/merged/{child['contractNameSlug']}", token)
    print(
        f"\nGộp hai lớp → {len(merged['clauses'])} điều khoản · "
        f"cha {merged['parentClauseCount']} · con {merged['childClauseCount']} · "
        f"bị ghi đè {merged['overriddenCodes']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
