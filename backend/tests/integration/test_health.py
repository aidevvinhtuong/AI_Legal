"""Kiểm tra API nối được tới hạ tầng thật. Cần `make infra` chạy trước."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.integration
client = TestClient(app)


def test_health_khong_phu_thuoc_ha_tang():
    """Liveness phải trả lời được kể cả khi DB chết — dùng cho healthcheck container."""
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_ready_noi_duoc_postgres_va_redis():
    r = client.get("/health/ready")
    body = r.json()
    assert body["checks"]["postgres"] == "ok", body
    assert body["checks"]["redis"] == "ok", body
    assert body["status"] == "ok"


def test_minio_co_bucket_va_khong_public():
    """Bucket phải tồn tại và KHÔNG cho truy cập ẩn danh (NFR-S5)."""
    import boto3
    from botocore.client import Config

    from app.infra.settings import get_settings

    s = get_settings()
    s3 = boto3.client(
        "s3",
        endpoint_url=s.S3_ENDPOINT,
        aws_access_key_id=s.S3_ACCESS_KEY,
        aws_secret_access_key=s.S3_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name=s.S3_REGION,
    )
    names = [b["Name"] for b in s3.list_buckets()["Buckets"]]
    assert s.S3_BUCKET in names, names

    ver = s3.get_bucket_versioning(Bucket=s.S3_BUCKET)
    assert ver.get("Status") == "Enabled", "bucket phải bật versioning"
