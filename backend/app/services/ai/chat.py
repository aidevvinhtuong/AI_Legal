"""
Chat sửa văn bản (PT1) — tầng thuần, không biết DB.

## Quy tắc quan trọng nhất của module này

    Resolve xem yêu cầu nhắm vào vùng nào TRƯỚC. Nếu không nhắm vào vùng mở nào
    thì **từ chối ngay, KHÔNG gọi LLM.**

Đây là yêu cầu tường minh của README/Blueprint, và nó không chỉ để tiết kiệm
token. Gọi LLM rồi mới lọc nghĩa là mô hình đã đọc yêu cầu "sửa điều khoản Luật
áp dụng" và đã sinh ra văn bản thay thế — thứ đó sẽ nằm trong log, trong
`ai_runs`, và sớm muộn có người copy tay vào tài liệu. Từ chối trước khi gọi thì
văn bản đó không bao giờ tồn tại.

Lớp chặn cuối vẫn là allow-list ở tầng ghi file (bất biến B1): chat chỉ sinh
**đề xuất**, người dùng chấp nhận thì đi qua `save_fields()` như mọi thay đổi
khác. Chat không có đường ghi riêng.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.services.ai import injection_guard
from app.services.ai.bm25 import Bm25Index, tokenize
from app.services.ai.ports import ChatModel
from app.services.ai.schemas import CHAT_EDIT
from app.services.document.model import fold_diacritics

log = logging.getLogger("ailegal.ai.chat")

# Điểm khớp tối thiểu để coi là "user đang nhắm vào vùng này". Dưới ngưỡng thì
# coi như không xác định được đích, và ta hỏi lại chứ không đoán.
MIN_TARGET_SCORE = 0.12
MAX_TARGETS = 3

# Điểm BM25 THÔ tối thiểu để coi câu hỏi thật sự nhắm vào nội dung một vùng.
#
# Dùng điểm thô chứ không phải điểm chuẩn hoá: chuẩn hoá theo giá trị lớn nhất
# nên vùng tốt nhất LUÔN được 1.0, kể cả khi câu hỏi chẳng liên quan gì.
#
# Đo trên template HDDV thật (14 vùng ghi được):
#     "Bạn xem giúp tôi"                       0,41   ← mơ hồ, phải từ chối
#     "hôm nay trời đẹp quá"                   0,00   ← vô nghĩa
#     "giúp tôi ghi địa chỉ vào là 123ACV"     3,16
#     "Đổi Nơi ký thành Thành phố Đà Nẵng"     6,20
#     "sửa thời hạn thanh toán thành 45 ngày" 12,05
#
# Ngưỡng phụ thuộc kích thước corpus và độ dài vùng, nên đây là giá trị hiệu
# chuẩn cho template hiện tại — gặp tài liệu khác lệch nhiều thì chỉnh lại.
MIN_BM25_SCORE = 1.5


@dataclass(frozen=True)
class ChatField:
    """Một vùng của tài liệu, nhìn từ góc độ chat."""

    perm_id: str
    label: str
    value: str
    writable: bool
    citation: str = ""
    # VÌ SAO không ghi được. Hai tình huống rất khác nhau mà trước đây dùng chung
    # một câu từ chối:
    #   `locked`      — Legal khoá điều khoản này, người dùng phải escalate
    #   `empty`       — vùng mở nhưng rỗng, không có định dạng để kế thừa
    #   `cross_table` — vùng mở nhưng bắc qua ranh giới bảng, writer không đụng
    # Nói "nằm trong vùng khoá" cho hai ca sau là sai sự thật, và người dùng sẽ
    # đi hỏi Legal một việc mà Legal không giải quyết được.
    unwritable_reason: str = "locked"

    @property
    def display(self) -> str:
        return self.label or f"vùng {self.perm_id}"


@dataclass(frozen=True)
class ChatEdit:
    perm_id: str
    new_text: str
    reason: str


@dataclass
class ChatResult:
    reply: str = ""
    edits: list[ChatEdit] = field(default_factory=list)
    refused: bool = False
    refusal_reason: str = ""
    targets: list[str] = field(default_factory=list)
    called_llm: bool = False
    injections: list[injection_guard.InjectionFinding] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0


# Dùng bản chung: `đ` không phân rã được bằng NFD nên phải map riêng, và bản
# tự viết trong module này từng thiếu đúng chỗ đó.
_fold = fold_diacritics


def _cites(citation: str, message: str) -> bool:
    """
    Câu của user có nhắc tới số điều khoản này không.

    So theo dãy số chứ không so cả chuỗi: `citation` là "Điều 14." (có dấu chấm
    do Word sinh) trong khi người dùng gõ "Điều 14" hoặc "điều 14 cần đổi".
    """
    digits = ".".join(part for part in re.findall(r"\d+", citation))
    if not digits:
        return False
    return re.search(rf"(?<!\d){re.escape(digits)}(?!\d)", message) is not None


def resolve_targets(message: str, fields: list[ChatField]) -> list[ChatField]:
    """
    Tìm vùng mà yêu cầu nhắm tới, **chỉ trong các vùng ghi được**.

    Ba tầng, cộng điểm:
      1. user gõ thẳng `permId`             → khớp tuyệt đối
      2. tên nghiệp vụ / số điều khoản xuất hiện trong câu → điểm cao
      3. BM25 trên nội dung vùng            → điểm nền

    Cố tình KHÔNG dùng embedding: đây là bước lọc an toàn chạy trước khi gọi
    mạng, nên nó phải hoạt động cả khi endpoint model chết.
    """
    writable = [f for f in fields if f.writable]
    if not writable:
        return []

    # Tầng 1 — permId gõ thẳng
    exact = [f for f in writable if f.perm_id and f.perm_id in message]
    if exact:
        return exact[:MAX_TARGETS]

    # Tầng 2 — nhãn nghiệp vụ và số điều khoản
    scores: dict[str, float] = {}
    for f in writable:
        bonus = _label_score(f, message)
        # "điều 4", "4.1" — số điều do Word sinh, không có trong luồng text nên
        # phải so với `citation` đã resolve chứ không grep tài liệu (bẫy F5)
        if f.citation and _cites(f.citation, message):
            bonus += 0.8
        scores[f.perm_id] = bonus

    # Tầng 3 — BM25 trên nội dung. Chặn nhiễu bằng điểm THÔ, không bằng số từ trùng.
    #
    # Bản trước lọc bỏ token dưới 4 ký tự trước khi đếm trùng. Sai với tiếng
    # Việt: tiếng Việt đơn âm nên hầu hết từ nội dung chỉ 2–3 ký tự sau khi bỏ
    # dấu. "địa chỉ" → "dia" + "chi", cả hai bị lọc sạch, và câu "ghi địa chỉ
    # vào…" không còn token nào để khớp. Gặp thật khi người dùng test trên UI.
    corpus = [f.value for f in writable]
    if any(corpus):
        index = Bm25Index.build(corpus)
        raw = index.scores(message)
        top = max(raw) if raw else 0.0
        if top >= MIN_BM25_SCORE:
            for f, value in zip(writable, raw, strict=False):
                scores[f.perm_id] += (value / top) * 0.5

    ranked = sorted(writable, key=lambda f: scores.get(f.perm_id, 0.0), reverse=True)
    top = scores.get(ranked[0].perm_id, 0.0) if ranked else 0.0

    # Gọi đúng tên MỘT vùng thì không kéo theo vùng khác chỉ vì trùng vài từ.
    # "Đổi Giá trị Hợp Đồng…" từng lôi cả "Điều khoản Thanh toán" vào (chung
    # token "thanh"), và mô hình được phép sửa luôn vùng người dùng không nhắc.
    floor = top * 0.6 if top >= LABEL_HIT else MIN_TARGET_SCORE
    return [f for f in ranked if scores.get(f.perm_id, 0.0) >= floor][:MAX_TARGETS]


# Câu từ chối theo đúng lý do không ghi được.
_REFUSAL = {
    "locked": (
        "“{name}” nằm trong vùng khoá của template — hệ thống không sửa được. "
        "Nếu cần thay đổi, yêu cầu này phải chuyển Legal xem xét sửa template "
        "hoặc lập phụ lục."
    ),
    "empty": (
        "“{name}” là vùng trống trong template — hệ thống không có định dạng để "
        "kế thừa nên không ghi được. Sửa trực tiếp bằng Word rồi tải lên lại, "
        "hoặc đề nghị Legal bổ sung nội dung mẫu cho vùng này."
    ),
    "cross_table": (
        "“{name}” bắc qua ranh giới bảng — hệ thống không ghi để tránh vỡ bảng. "
        "Sửa trực tiếp bằng Word rồi tải lên lại."
    ),
}


def _label_score(field: ChatField, message: str) -> float:
    """
    Câu hỏi khớp TÊN vùng tới đâu, theo tỷ lệ token trùng (0…1).

    Không so chuỗi con nữa. So chuỗi con đòi người dùng gõ **y hệt** nhãn: nhãn
    "Phần mở đầu (trống)" thì gõ "Phần mở đầu" là trượt, và hệ thống lẳng lặng
    đi sửa một vùng khác. Đã gặp thật khi chạy thử trên UI.
    """
    if not field.label:
        return 0.0
    terms = {t for t in tokenize(_fold(field.label)) if len(t) >= 2}
    if not terms:
        return 0.0

    hit = terms & set(tokenize(_fold(message)))
    if not hit:
        return 0.0
    # Nhãn một từ thì phải đủ dài mới tính — "Thuế" khớp bừa quá dễ
    if len(terms) == 1 and len(next(iter(terms))) < 4:
        return 0.0
    return len(hit) / len(terms)


# Tỷ lệ token của nhãn phải xuất hiện trong câu hỏi mới coi là gọi đúng tên.
LABEL_HIT = 0.6


def _unwritable_hint(message: str, fields: list[ChatField]) -> tuple[ChatField, str] | None:
    """
    Yêu cầu có nhắm vào vùng KHÔNG ghi được nào không.

    Xếp hạng **toàn bộ** vùng theo mức khớp tên rồi mới quyết, chứ không trả về
    vùng khoá đầu tiên chạm tới: "Nơi ký hợp đồng" và "Số hợp đồng" dùng chung
    hai token, nên duyệt theo thứ tự sẽ từ chối nhầm. Chỉ chặn khi vùng khớp
    NHẤT là vùng không ghi được.

    Trả `(field, tên đã khớp)` — câu từ chối phải gọi vùng đó bằng **đúng thứ
    người dùng vừa gõ**: gõ "Điều 14" thì trả lời "Điều 14".
    """
    # Số điều khoản là tham chiếu tuyệt đối, không cạnh tranh với nhãn
    for f in fields:
        if not f.writable and f.citation and _cites(f.citation, message):
            return f, f.citation

    if not fields:
        return None
    best = max(fields, key=lambda f: _label_score(f, message))
    if _label_score(best, message) < LABEL_HIT or best.writable:
        return None
    return best, best.label


def run(
    *,
    message: str,
    fields: list[ChatField],
    history: list[tuple[str, str]],
    clauses: list[dict[str, Any]],
    contract_type: str,
    model: ChatModel | None,
    system_prompt: str,
) -> ChatResult:
    """
    Xử lý một lượt chat. Không bao giờ ném ra ngoài.

    Thứ tự BẮT BUỘC: quét injection → resolve đích → (chỉ khi có đích mở) gọi LLM.
    """
    result = ChatResult()
    result.injections = injection_guard.scan(message)

    # ── Nhắc TÊN một vùng không ghi được thì từ chối NGAY ─────────────────
    # Quyền ưu tiên này là cố ý. Nếu để BM25 chạy trước, câu "sửa Điều 14 về
    # luật áp dụng" sẽ khớp mờ vào vùng Thanh toán (chung các từ "điều",
    # "thanh", "dụng") rồi gọi LLM — đo được trên máy dev. Một câu chỉ đúng
    # tên điều khoản bị khoá là ý định rõ ràng, không phải chỗ để đoán.
    hint = _unwritable_hint(message, fields)
    if hint is not None:
        blocked, name = hint
        template = _REFUSAL.get(blocked.unwritable_reason, _REFUSAL["locked"])
        result.refused = True
        result.refusal_reason = template.format(name=name)
        result.reply = result.refusal_reason
        log.info("chat từ chối trước khi gọi LLM (%s): %s", blocked.unwritable_reason, name)
        return result

    targets = resolve_targets(message, fields)
    result.targets = [f.perm_id for f in targets]

    if not targets:
        # ── Từ chối TRƯỚC khi gọi LLM ─────────────────────────────────────
        result.refused = True
        if not any(f.writable for f in fields):
            result.refusal_reason = (
                "Tài liệu này không có vùng nào hệ thống sửa được — chỉ xem và chú thích."
            )
        else:
            # Liệt kê KÈM trích dẫn nội dung. Chỉ nêu tên là vô dụng khi template
            # chưa được Legal đặt tên nghiệp vụ: người dùng nhìn "Vùng mở #2 …
            # #15" thì không biết vùng nào là địa chỉ. Gặp thật khi test trên UI.
            result.refusal_reason = (
                "Chưa xác định được yêu cầu nhắm vào vùng nào. Nói rõ tên vùng, "
                "hoặc trích một đoạn nội dung trong vùng cần sửa.\n\n"
                "Các vùng sửa được:\n" + _catalogue(fields)
            )
        result.reply = result.refusal_reason
        log.info("chat từ chối trước khi gọi LLM: %s", result.refusal_reason[:80])
        return result

    if model is None:
        result.refused = True
        result.refusal_reason = (
            "Dịch vụ mô hình đang không phản hồi — chưa sinh được đề xuất sửa. "
            f"Vùng liên quan: {', '.join(f.display for f in targets)}."
        )
        result.reply = result.refusal_reason
        return result

    allowed = {f.perm_id for f in targets}
    try:
        output = model.chat(
            system=system_prompt,
            user=_build_prompt(
                message=message,
                targets=targets,
                history=history,
                clauses=clauses,
                contract_type=contract_type,
            ),
            json_schema=CHAT_EDIT,
            schema_name="chat_edit",
            temperature=0.0,
        )
    except Exception as e:
        log.warning("chat_edit gọi LLM lỗi: %s", e)
        result.refused = True
        result.refusal_reason = f"Không gọi được mô hình: {e}"
        result.reply = "Hệ thống chưa sinh được đề xuất. Thử lại sau ít phút."
        return result

    result.called_llm = True
    result.input_tokens = output.input_tokens
    result.output_tokens = output.output_tokens
    result.latency_ms = output.latency_ms

    data = output.data or {}
    result.reply = str(data.get("reply") or "").strip()
    result.refused = bool(data.get("refused"))
    result.refusal_reason = str(data.get("refusal_reason") or "").strip()

    # ── Lọc lần hai: LLM chỉ được sửa đúng vùng ta đã cho phép ────────────
    # Guided JSON không ràng buộc được `field_id`, nên mô hình vẫn có thể trả về
    # permId khác — kể cả khi không bị lừa, chỉ đơn giản là nhầm.
    for raw in data.get("edits") or []:
        perm_id = str(raw.get("field_id") or "")
        if perm_id not in allowed:
            log.warning("bỏ đề xuất nhắm ra ngoài đích đã resolve: %s", perm_id)
            continue
        new_text = str(raw.get("new_text") or "")
        if not new_text.strip():
            continue
        result.edits.append(
            ChatEdit(
                perm_id=perm_id,
                new_text=new_text,
                reason=str(raw.get("reason") or "").strip(),
            )
        )

    if not result.reply:
        result.reply = (
            f"Đã soạn {len(result.edits)} đề xuất sửa."
            if result.edits
            else "Chưa có thay đổi nào cần đề xuất."
        )
    elif not result.edits and not result.refused:
        # Đo được: mô hình trả lời "Đã cập nhật nội dung vùng X thành …" nhưng
        # `edits` rỗng. Người dùng đọc câu đó sẽ tưởng tài liệu đã đổi. Không sửa
        # được lời của mô hình, nhưng bắt buộc phải nói rõ sự thật kèm theo.
        result.reply += (
            "\n\n_Lưu ý: chưa có đề xuất nào được tạo — nội dung tài liệu **chưa "
            "thay đổi**. Hãy nói rõ vùng cần sửa và nội dung mong muốn._"
        )
    return result


def _catalogue(fields: list[ChatField], limit: int = 12) -> str:
    """Danh mục vùng sửa được, kèm trích dẫn nội dung để người dùng nhận ra."""
    lines = []
    for f in [x for x in fields if x.writable][:limit]:
        snippet = " ".join((f.value or "").split())[:60]
        lines.append(f"• {f.display}" + (f" — “{snippet}…”" if snippet else " — (đang trống)"))
    return "\n".join(lines)


def _build_prompt(
    *,
    message: str,
    targets: list[ChatField],
    history: list[tuple[str, str]],
    clauses: list[dict[str, Any]],
    contract_type: str,
) -> str:
    """
    Chỉ đưa vào prompt **các vùng đã resolve**, không phải cả tài liệu.

    Ngoài chuyện rẻ hơn: mô hình không nhìn thấy vùng khoá thì không thể đề xuất
    sửa vùng khoá, dù có bị lừa.
    """
    lines = [f"Loại hợp đồng: {contract_type}", "", "## Vùng được phép sửa", ""]
    for f in targets:
        head = f"### {f.display} (field_id = {f.perm_id})"
        if f.citation:
            head += f" — {f.citation}"
        lines += [head, injection_guard.wrap_untrusted(f.value or "(đang rỗng)"), ""]

    if clauses:
        lines += ["## Điều khoản checklist liên quan", ""]
        for c in clauses[:12]:
            lines.append(
                f"- [{c.get('code')}] {c.get('name')} · mức: {c.get('severity')} · "
                f"loại: {c.get('kind')}"
            )
        lines.append("")

    if history:
        lines += ["## Hội thoại trước đó", ""]
        for role, content in history[-6:]:
            lines.append(f"{'User' if role == 'user' else 'AI'}: {content[:400]}")
        lines.append("")

    lines += ["## Yêu cầu mới của user", "", injection_guard.wrap_untrusted(message)]
    return "\n".join(lines)


__all__ = ["ChatEdit", "ChatField", "ChatResult", "resolve_targets", "run"]
