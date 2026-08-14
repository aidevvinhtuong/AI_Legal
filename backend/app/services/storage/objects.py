"""
Object storage (MinIO qua S3 API).

Phản biện quyết định D3 ("lưu file trong DB"): blob nằm ở MinIO **self-hosted**,
DB chỉ giữ metadata + hash. Vẫn hoàn toàn trong hạ tầng nội bộ nên thoả NFR-S1,
mà không làm phình DB, chậm backup, nặng replication (TS-02 mục VII).

Điểm yếu duy nhất của việc tách hai kho là **mất tính nguyên tử**: commit DB
xong mà ghi MinIO hỏng thì có bản ghi trỏ vào file không tồn tại. Cách xử lý ở
đây: **ghi object TRƯỚC, commit DB SAU**. Hỏng giữa chừng chỉ để lại object mồ
côi — vô hại, và job quét dọn theo `sha256` sẽ thu hồi.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.domain.errors import UpstreamError
from app.infra.settings import get_settings


@dataclass(frozen=True)
class StoredObject:
    key: str
    sha256: str
    size_bytes: int
    content_type: str


class ObjectStorage:
    def __init__(self) -> None:
        settings = get_settings()
        self._bucket = settings.S3_BUCKET
        self._ttl = settings.S3_PRESIGN_TTL
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
            # MinIO cần signature v4 và path-style addressing
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    # ── Ghi ───────────────────────────────────────────────────────────────
    def put(
        self,
        data: bytes,
        *,
        prefix: str,
        file_name: str,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> StoredObject:
        """
        Khoá object gồm ngày + uuid, KHÔNG dùng tên file người dùng đặt.

        Tên file gốc có thể chứa dấu tiếng Việt, khoảng trắng, hoặc `../` —
        không thứ nào nên xuất hiện trong khoá lưu trữ. Tên gốc giữ ở DB.
        """
        digest = hashlib.sha256(data).hexdigest()
        today = datetime.now(timezone.utc).strftime("%Y/%m/%d")
        suffix = _extension(file_name)
        key = f"{prefix}/{today}/{uuid.uuid4().hex}{suffix}"

        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                Metadata={"sha256": digest, **(metadata or {})},
            )
        except (BotoCoreError, ClientError) as e:
            raise UpstreamError("object storage", f"Không ghi được file: {e}") from e

        return StoredObject(
            key=key, sha256=digest, size_bytes=len(data), content_type=content_type
        )

    # ── Đọc ───────────────────────────────────────────────────────────────
    def get(self, key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            return response["Body"].read()
        except (BotoCoreError, ClientError) as e:
            raise UpstreamError("object storage", f"Không đọc được file: {e}") from e

    def presign(self, key: str, *, file_name: str | None = None) -> str:
        """
        Link tải có hạn ngắn (mặc định 120 giây).

        Đủ để trình duyệt tải xong, không đủ để chuyển cho người khác dùng lại.
        Bucket đã tắt truy cập ẩn danh nên đây là đường duy nhất ra ngoài.
        """
        params: dict[str, Any] = {"Bucket": self._bucket, "Key": key}
        if file_name:
            params["ResponseContentDisposition"] = f'attachment; filename="{_ascii(file_name)}"'
        try:
            return self._client.generate_presigned_url(
                "get_object", Params=params, ExpiresIn=self._ttl
            )
        except (BotoCoreError, ClientError) as e:
            raise UpstreamError("object storage", f"Không tạo được link tải: {e}") from e

    def ensure_bucket(self) -> None:
        """Gọi lúc khởi động ở dev; ở prod `minio-init` đã tạo sẵn."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError:
            try:
                self._client.create_bucket(Bucket=self._bucket)
            except (BotoCoreError, ClientError) as e:
                raise UpstreamError("object storage", f"Không tạo được bucket: {e}") from e


def _extension(file_name: str) -> str:
    _, dot, ext = file_name.rpartition(".")
    return f".{ext.lower()}" if dot and len(ext) <= 8 and ext.isalnum() else ""


def _ascii(text: str) -> str:
    """Header HTTP chỉ nhận latin-1 — bỏ dấu tiếng Việt thay vì làm hỏng response."""
    import unicodedata

    normalized = unicodedata.normalize("NFKD", text)
    return normalized.encode("ascii", "ignore").decode("ascii") or "document.docx"


_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    global _storage
    if _storage is None:
        _storage = ObjectStorage()
    return _storage
