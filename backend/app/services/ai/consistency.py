"""
Stage 0.5 — kiểm tra nhất quán bằng CODE, không dùng LLM.

Vì sao đây là thành phần bậc một chứ không phải phần phụ: loại lỗi này
deterministic, rẻ, đúng 100%, và bắt được thứ LLM hay bỏ sót. Bằng chứng thực
tế (PH-7): trong hợp đồng THACO đang lưu hành, cùng một số tiền `685.000.000`
được ghi bằng chữ hai kiểu khác nhau —

    "Sáu trăm tám lăm **triệu** đồng chẵn"      (đúng)
    "Sáu trăm tám mươi lăm **nghìn** đồng chẵn" (SAI, lệch 1.000 lần)

Một lỗi lệch nghìn lần, nằm ngay trong điều khoản Thanh toán, mà vòng review
của người thật đã bỏ qua.

Module này là thư viện THUẦN: không DB, không HTTP, không LLM.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# ─────────────────────────────────────────────────────────────────────────────
# Số → chữ tiếng Việt
# ─────────────────────────────────────────────────────────────────────────────
_DIGITS = ("không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín")
_SCALES = ("", "nghìn", "triệu", "tỷ")


def _three_digits(number: int, *, full: bool) -> str:
    """Đọc một nhóm ba chữ số. `full` = có nhóm lớn hơn đứng trước."""
    hundreds, remainder = divmod(number, 100)
    tens, units = divmod(remainder, 10)
    parts: list[str] = []

    if hundreds or full:
        parts += [_DIGITS[hundreds], "trăm"]

    if tens == 0:
        if units:
            if hundreds or full:
                parts.append("linh")
            parts.append(_DIGITS[units])
    elif tens == 1:
        parts.append("mười")
        if units == 5:
            parts.append("lăm")
        elif units:
            parts.append(_DIGITS[units])
    else:
        parts += [_DIGITS[tens], "mươi"]
        if units == 1:
            parts.append("mốt")
        elif units == 5:
            parts.append("lăm")
        elif units:
            parts.append(_DIGITS[units])

    return " ".join(parts)


def number_to_vietnamese(number: int) -> str:
    """
    `685000000` → `"sáu trăm tám mươi lăm triệu"`.

    Chỉ dùng để SO SÁNH, không dùng để sinh văn bản cho hợp đồng — cách đọc
    tiếng Việt có nhiều biến thể hợp lệ (`tám lăm` / `tám mươi lăm`,
    `linh` / `lẻ`), nên phép so khớp phải chấp nhận biến thể (xem `_variants`).
    """
    if number == 0:
        return _DIGITS[0]

    groups: list[int] = []
    while number > 0:
        number, rest = divmod(number, 1000)
        groups.append(rest)

    chunks: list[str] = []
    for index in range(len(groups) - 1, -1, -1):
        value = groups[index]
        if value == 0:
            continue
        text = _three_digits(value, full=index < len(groups) - 1)
        scale = _SCALES[index] if index < len(_SCALES) else _SCALES[-1]
        chunks.append(f"{text} {scale}".strip())

    return " ".join(chunks).strip()


def _fold(text: str) -> str:
    """Bỏ dấu, hạ chữ thường, gộp khoảng trắng — chỉ dùng khi SO SÁNH."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.replace("đ", "d")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _variants(number: int) -> set[str]:
    """Các cách đọc hợp lệ của cùng một con số."""
    base = number_to_vietnamese(number)
    out = {base}
    out.add(base.replace("linh", "lẻ"))
    # "tám mươi lăm" ↔ "tám lăm" — lối nói tắt rất phổ biến trong hợp đồng
    out.add(re.sub(r"(\w+) mươi lăm", r"\1 lăm", base))
    out.add(base.replace("nghìn", "ngàn"))
    return {_fold(v) for v in out}


# ─────────────────────────────────────────────────────────────────────────────
# Rule
# ─────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ConsistencyIssue:
    """Một phát hiện của tầng rule. `field_id` có ⇒ Loại A, không ⇒ Loại B."""

    rule: str
    severity: str  # block | high | low
    group: str  # red_flag | warning | missing_protection
    title: str
    description: str
    field_id: str | None = None
    evidence: str = ""


_AMOUNT = re.compile(r"(\d{1,3}(?:[.,]\d{3})+|\d{4,})")
_IN_WORDS = re.compile(
    r"(?:bằng\s+chữ|viết\s+bằng\s+chữ)\s*[:\-]?\s*([^)\]\n;]{4,120})",
    re.IGNORECASE,
)
_PLACEHOLDER = re.compile(r"^[\s_.…\-–—]*$")


def _to_int(raw: str) -> int | None:
    digits = re.sub(r"[.,\s]", "", raw)
    return int(digits) if digits.isdigit() else None


def check_amount_in_words(text: str, *, field_id: str | None = None) -> list[ConsistencyIssue]:
    """
    Số tiền ↔ số tiền bằng chữ.

    Chỉ báo khi tìm được **một** con số ứng viên gần cụm "bằng chữ" — nhiều số
    lẫn lộn thì không đủ căn cứ để khẳng định cái nào sai, báo bừa sẽ làm người
    dùng mất tin vào toàn bộ hệ thống.
    """
    issues: list[ConsistencyIssue] = []

    for match in _IN_WORDS.finditer(text):
        words = match.group(1).strip()
        folded_words = _fold(words)
        if not folded_words:
            continue

        prefix = text[: match.start()]
        numbers = [_to_int(m.group(1)) for m in _AMOUNT.finditer(prefix[-160:])]
        numbers = [n for n in numbers if n]
        if not numbers:
            continue
        amount = numbers[-1]

        if any(variant and variant in folded_words for variant in _variants(amount)):
            continue

        issues.append(
            ConsistencyIssue(
                rule="amount_in_words_mismatch",
                severity="block",
                group="red_flag",
                title="Số tiền bằng chữ không khớp số",
                description=(
                    f"Số ghi là {amount:,}".replace(",", ".")
                    + f" nhưng phần bằng chữ đọc là “{words.strip()}”. "
                    f"Cách đọc đúng: “{number_to_vietnamese(amount)}”."
                ),
                field_id=field_id,
                evidence=words.strip()[:120],
            )
        )

    return issues


def check_required_field_filled(field_id: str, label: str, value: str) -> list[ConsistencyIssue]:
    """Ô còn `______` là hợp đồng chưa điền xong — lỗi hay gặp và dễ lọt nhất."""
    if value and not _PLACEHOLDER.match(value):
        return []
    return [
        ConsistencyIssue(
            rule="empty_required_field",
            severity="high",
            group="missing_protection",
            title=f"Chưa điền: {label}",
            description="Trường này còn để trống hoặc còn dấu gạch chân mẫu.",
            field_id=field_id,
            evidence=value[:60],
        )
    ]


def check_currency_units(text: str, *, field_id: str | None = None) -> list[ConsistencyIssue]:
    """Trộn nhiều đơn vị tiền tệ trong cùng một điều khoản là dấu hiệu sao chép nhầm."""
    folded = _fold(text)
    units = {u for u in ("vnd", "usd", "eur", "jpy") if re.search(rf"\b{u}\b", folded)}
    if len(units) < 2:
        return []
    return [
        ConsistencyIssue(
            rule="mixed_currency",
            severity="high",
            group="warning",
            title="Nhiều đơn vị tiền tệ trong cùng một vùng",
            description="Phát hiện " + ", ".join(sorted(u.upper() for u in units)) + ".",
            field_id=field_id,
            evidence=", ".join(sorted(units)),
        )
    ]


def run_all(fields: list[tuple[str, str, str]]) -> list[ConsistencyIssue]:
    """
    Chạy toàn bộ rule trên danh sách `(perm_id, label, value)`.

    Trả về theo thứ tự nghiêm trọng giảm dần để UI hiển thị cái nguy hiểm trước.
    """
    issues: list[ConsistencyIssue] = []
    for perm_id, label, value in fields:
        issues += check_amount_in_words(value, field_id=perm_id)
        issues += check_currency_units(value, field_id=perm_id)
        issues += check_required_field_filled(perm_id, label, value)

    rank = {"block": 0, "high": 1, "low": 2}
    return sorted(issues, key=lambda i: rank.get(i.severity, 3))
