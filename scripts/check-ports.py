#!/usr/bin/env python3
"""check-ports.py — kiểm tra cổng nào đang bị chiếm, để chọn cổng cho docker-compose."""
import socket
import sys

PORTS = {
    5432: "PostgreSQL", 5433: "PostgreSQL (dự phòng)",
    6379: "Redis", 6380: "Redis (dự phòng)",
    9000: "MinIO API", 9001: "MinIO Console",
    9100: "MinIO API (dự phòng)", 9101: "MinIO Console (dự phòng)",
    8000: "API", 8001: "API", 8008: "API (dự phòng)", 8010: "API (dự phòng)",
    3000: "Frontend", 3001: "Frontend (dự phòng)",
    5555: "Flower", 5556: "Flower (dự phòng)",
}


def is_open(port: int) -> bool:
    for host in ("127.0.0.1", "0.0.0.0"):
        try:
            with socket.create_connection((host, port), timeout=0.4):
                return True
        except OSError:
            continue
    return False


def main() -> int:
    extra = [int(a) for a in sys.argv[1:] if a.isdigit()]
    ports = {**PORTS, **{p: "(chỉ định)" for p in extra}}
    print(f"{'CỔNG':>6}  {'TRẠNG THÁI':<12} DỰ KIẾN DÙNG CHO")
    print("-" * 56)
    free = []
    for p in sorted(ports):
        busy = is_open(p)
        if not busy:
            free.append(p)
        print(f"{p:>6}  {'ĐANG CHIẾM' if busy else 'trống':<12} {ports[p]}")
    print("-" * 56)
    print("Cổng trống:", ", ".join(map(str, free)) or "(không có)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
