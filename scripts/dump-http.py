#!/usr/bin/env python3
"""dump-http.py — in phản hồi thô của vài URL, để phân biệt service thật với sandbox proxy."""
import sys
import urllib.error
import urllib.request

urls = sys.argv[1:] or [
    "http://127.0.0.1:8000/v1/models",
    "http://127.0.0.1:8001/v1/models",
    "http://127.0.0.1:8080/v1/models",
    "http://127.0.0.1:11434/api/tags",
]
for u in urls:
    print("=" * 70)
    print(u)
    try:
        with urllib.request.urlopen(u, timeout=3) as r:
            body = r.read()[:300].decode("utf-8", "replace")
            print(f"  HTTP {r.status}  {dict(r.headers).get('Content-Type','?')}")
            print(f"  {body!r}")
    except urllib.error.HTTPError as e:
        print(f"  HTTPError {e.code}: {e.read()[:200]!r}")
    except Exception as e:
        print(f"  {type(e).__name__}: {e}")
