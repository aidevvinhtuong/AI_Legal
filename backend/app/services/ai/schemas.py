"""
JSON Schema cho từng stage — dùng với guided decoding của endpoint.

Đây là lý do không phải parse JSON bằng regex: schema được ép ngay lúc sinh
token, model **không thể** trả về cấu trúc khác. Prompt v1 chỉ nói "trả về JSON
có cấu trúc rõ ràng" mà không định nghĩa gì — đó là chỗ hỏng phải vá.

Quy ước: `additionalProperties: false` ở mọi cấp. Model bịa thêm khoá là dấu
hiệu nó đang tự do hơn mức cho phép.
"""

from __future__ import annotations

from typing import Any

# Sáu phán quyết có thể có cho một điều khoản (TS-05 Stage 2)
VERDICTS = (
    "ideal_met",  # đạt chuẩn Ideal của Legal
    "fallback_met",  # không đạt Ideal nhưng còn trong ngưỡng Fallback
    "below_fallback",  # dưới Fallback — phải cảnh báo
    "red_line_violation",  # vượt Red Line — không được tự đề xuất câu chữ
    "missing",  # không tìm thấy điều khoản trong hợp đồng
    "not_applicable",  # điều khoản không áp dụng cho hợp đồng này
)

CLAUSE_JUDGMENT: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clause_code", "verdict", "rationale", "self_confidence"],
    "properties": {
        "clause_code": {"type": "string", "description": "Mã điều khoản đang xét"},
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "rationale": {
            "type": "string",
            "maxLength": 600,
            "description": "Giải thích ngắn bằng tiếng Việt, dựa trên trích dẫn từ hợp đồng",
        },
        "evidence_quote": {
            "type": "string",
            "maxLength": 500,
            "description": "Trích nguyên văn đoạn làm căn cứ. Rỗng nếu verdict=missing",
        },
        "proposed_text": {
            "type": "string",
            "maxLength": 4000,
            "description": (
                "Câu chữ đề xuất thay thế. CHỈ điền khi vùng đang xét là vùng mở "
                "và verdict KHÔNG phải red_line_violation"
            ),
        },
        "self_confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Mức tự tin của chính phán quyết này",
        },
        "injection_suspected": {
            "type": "boolean",
            "description": "Đoạn văn bản chứa chỉ dẫn nhằm điều khiển AI",
        },
    },
}

# Stage 5 — LLM chỉ viết diễn giải. TUYỆT ĐỐI không có trường số nào ở đây:
# hai điểm số do code tính (bất biến B2).
NARRATIVE: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["ai_summary", "fairness_notes"],
    "properties": {
        "ai_summary": {
            "type": "string",
            "maxLength": 1200,
            "description": "Tóm tắt kết quả rà soát bằng tiếng Việt cho người đọc nghiệp vụ",
        },
        "fairness_notes": {
            "type": "string",
            "maxLength": 1200,
            "description": "Nhận định về mức cân bằng của hợp đồng, KHÔNG kèm điểm số",
        },
    },
}

CHAT_EDIT: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reply", "edits"],
    "properties": {
        "reply": {"type": "string", "maxLength": 1500},
        "edits": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["field_id", "new_text", "reason"],
                "properties": {
                    "field_id": {"type": "string", "description": "permId của vùng mở"},
                    "new_text": {"type": "string", "maxLength": 8000},
                    "reason": {"type": "string", "maxLength": 400},
                },
            },
        },
        "refused": {
            "type": "boolean",
            "description": "True khi yêu cầu nhắm vào vùng khoá hoặc vượt Red Line",
        },
        "refusal_reason": {"type": "string", "maxLength": 400},
    },
}

STAGE_SCHEMAS: dict[str, dict[str, Any]] = {
    "checklist_review": CLAUSE_JUDGMENT,
    "ai_summary_fairness": NARRATIVE,
    "chat_edit": CHAT_EDIT,
}
