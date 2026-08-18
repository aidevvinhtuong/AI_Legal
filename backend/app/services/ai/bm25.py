"""
BM25 tính tại chỗ — thay cho vector sparse.

Thiết kế gốc (`TS-05` mục V) dùng BGE-M3 cho cả dense và sparse:

    score = 0.7·cosine(dense) + 0.3·lexical(sparse)

Model đang chạy chỉ có dense, nên tầng từ vựng chuyển sang BM25 tính trên chính
tập segment của tài liệu đó (~50 đoạn). Rẻ, không cần index toàn cục, và không
phụ thuộc thêm dịch vụ nào.

Tokenizer tiếng Việt: tách theo khoảng trắng + NFC + hạ chữ thường. **Không**
dùng word segmenter — thêm một phụ thuộc nặng mà lợi ích chưa chứng minh được.
Đánh giá lại nếu golden set cho thấy recall kém.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

K1 = 1.5  # bão hoà tần suất từ
B = 0.75  # mức chuẩn hoá theo độ dài đoạn

_TOKEN = re.compile(r"[0-9a-zà-ỹ]+", re.IGNORECASE)


def tokenize(text: str) -> list[str]:
    """NFC + hạ chữ thường + tách từ. Giữ chữ số vì ngưỡng hợp đồng toàn là số."""
    normalized = unicodedata.normalize("NFC", text).lower()
    return _TOKEN.findall(normalized)


@dataclass
class Bm25Index:
    """Index trên một tập tài liệu nhỏ. Dựng lại mỗi lần review, không cache."""

    docs: list[list[str]]
    avg_len: float
    idf: dict[str, float]

    @classmethod
    def build(cls, texts: list[str]) -> Bm25Index:
        docs = [tokenize(t) for t in texts]
        total = len(docs)
        avg_len = (sum(len(d) for d in docs) / total) if total else 0.0

        seen = Counter()
        for doc in docs:
            for term in set(doc):
                seen[term] += 1

        # IDF theo biến thể có cộng 1 để không ra giá trị âm khi từ xuất hiện
        # ở gần hết các đoạn — chuyện rất hay gặp trong hợp đồng ("Bên", "Hợp Đồng")
        idf = {
            term: math.log(1 + (total - freq + 0.5) / (freq + 0.5)) for term, freq in seen.items()
        }
        return cls(docs=docs, avg_len=avg_len, idf=idf)

    def score(self, query: str, index: int) -> float:
        if index >= len(self.docs) or not self.avg_len:
            return 0.0

        doc = self.docs[index]
        if not doc:
            return 0.0

        counts = Counter(doc)
        length = len(doc)
        total = 0.0
        for term in set(tokenize(query)):
            freq = counts.get(term, 0)
            if not freq:
                continue
            weight = self.idf.get(term, 0.0)
            total += weight * (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * length / self.avg_len))
        return total

    def scores(self, query: str) -> list[float]:
        return [self.score(query, i) for i in range(len(self.docs))]


def normalise(values: list[float]) -> list[float]:
    """
    Đưa điểm BM25 về [0, 1] để cộng được với cosine.

    Chuẩn hoá theo GIÁ TRỊ LỚN NHẤT trong cùng một lần truy vấn, không dùng
    ngưỡng tuyệt đối: BM25 không có trần cố định, một ngưỡng cứng sẽ đúng với
    tài liệu này và sai với tài liệu khác.
    """
    if not values:
        return []
    top = max(values)
    if top <= 0:
        return [0.0] * len(values)
    return [v / top for v in values]
