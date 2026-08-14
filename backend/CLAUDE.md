# CLAUDE.md — Quy ước làm việc trong `backend/`

> Dự án: **AI Legal** — Hệ thống AI Review Hợp đồng, Saint-Gobain Việt Nam.
> Thiết kế đầy đủ ở [`docs/technical-solution/`](../docs/technical-solution/). Kế hoạch vòng hiện tại: [`TS-12`](../docs/technical-solution/TS-12-implementation-plan.md).
> File này là **quy ước khi viết code**, không lặp lại thiết kế.

---

## 1. Bất biến — vi phạm là lỗi nghiêm trọng

Bốn điều dưới đây không có ngoại lệ, không có cờ tắt, không "tạm thời bỏ qua để test".

| # | Bất biến | Nơi thực thi |
|---|----------|--------------|
| **B1** | **Không byte nào trong vùng khoá của hợp đồng được thay đổi.** Kể cả khi LLM bị lừa, frontend bị bypass, hay user cố tình | `services/document/allowlist.py` (lọc trước) + `postcheck.py` (kiểm sau). Cả hai đều bắt buộc chạy |
| **B2** | **LLM không bao giờ sinh ra con số điểm.** Hai điểm số do `services/ai/scorer.py` tính bằng code, deterministic | `scorer.py`; prompt `ai_summary_fairness` cấm tường minh |
| **B3** | **Không hardcode nội dung pháp lý** (số ngày, %, tên điều khoản, ngưỡng) trong code hoặc prompt. Nó thuộc Legal, nằm ở bảng `checklist_clauses` | CI `scripts/validate-prompts.js` + grep trong CI |
| **B4** | **RBAC enforce ở tầng repository**, không phải ở router. Router quên kiểm thì vẫn an toàn | `domain/rbac.py` + mệnh đề `WHERE` trong repository |

Khi sửa code chạm vào 4 vùng này, phải có test đi kèm chứng minh bất biến còn nguyên.

---

## 2. Ranh giới kiến trúc

```
app/services/document/   ★ thư viện thuần
app/services/ai/         ★ thư viện thuần
```

Hai package này **không được import**: `fastapi`, `sqlalchemy`, `celery`, `app.api`, `app.infra.db`.

Chúng nhận và trả object thuần (`bytes`, `dataclass`, `dict`). Lý do: phải chạy được test trên `.docx` thật mà không cần dựng DB — điều kiện để bộ `tests/format_fidelity/` chạy trong CI.

Kiểm bằng `import-linter`, chạy trong `make lint`. Đừng gỡ contract này để tiện tay.

**Luồng phụ thuộc một chiều:**
```
api → services → infra
        ↓
      domain        ← TRUNG TÂM: không phụ thuộc gì
```
`services` không biết gì về HTTP. `domain` (từ vựng nghiệp vụ, máy trạng thái,
RBAC) không import `fastapi`, `sqlalchemy`, `app.services`, `app.infra` — nhờ vậy
toàn bộ luật nghiệp vụ test được bằng bảng thuần, không cần dựng hạ tầng.

> Bản đầu của file này ghi `api → domain → services → infra`. Sai chiều: thực tế
> service *dùng* domain chứ không ngược lại. Contract trong `pyproject.toml` đã
> sửa theo sơ đồ trên, và chặt hơn bản cũ.

---

## 3. Lệnh hay dùng

```bash
make up            # docker compose up -d — stack DEV (code mount, --reload)
make infra         # chỉ postgres/redis/minio, chạy api ở host bằng `make dev`
make prod-up       # stack PROD: image bất biến, migrate one-shot, 4 worker
make down
make logs          # theo dõi api + worker
make migrate       # alembic upgrade head
make revision m="thêm bảng x"
make seed          # user mẫu + 1 loại HĐ + template THACO
make test          # pytest toàn bộ
make test-fx       # chỉ format fidelity (cần .docx thật trong tests/corpus/)
make lint          # ruff + import-linter
make fmt           # ruff format
make check-models  # kiểm chứng 3 endpoint LLM/embed/rerank
```

Chạy Python luôn qua `.venv/bin/python`, không dùng python hệ thống.

---

## 4. Cấu hình

Mọi thứ qua biến môi trường, đọc bằng `pydantic-settings` ở `infra/settings.py`. Không đọc `os.environ` rải rác trong code.

**Cổng đã bị chiếm trên máy dev** (PBI Analysis API ở 8000/8001, Airflow ở 8080) — dùng đúng bảng này:

| Dịch vụ | Cổng host |
|---|:---:|
| API | **8010** |
| PostgreSQL | 55432 |
| Redis | 63790 |
| MinIO API / Console | 9100 / 9101 |

Frontend phải đặt `API_REWRITE_URL=http://localhost:8010` (Next rewrite proxy
`/api/*`), hoặc `NEXT_PUBLIC_API_URL=http://localhost:8010` nếu gọi trực tiếp.

**Tiền tố API là `/api/v1/`** — do BE làm chủ, FE đổi theo. Xem `GET /docs`.

### Ba endpoint model — đã có sẵn, chỉ gọi

```bash
LLM_BASE_URL=http://171.244.136.217:8386/v1
LLM_MODEL=Qwen/Qwen3.6-27B
LLM_API_KEY=EMPTY                    # phải gửi header, giá trị không kiểm

EMBED_BASE_URL=http://171.244.136.217:8387    # TEI: POST /embed
EMBED_DIM=1024                                # AITeamVN/Vietnamese_Embedding

RERANK_BASE_URL=http://171.244.136.217:8389   # TEI: POST /rerank
```

**Ba điều bắt buộc khi gọi LLM:**

1. `chat_template_kwargs: {"enable_thinking": false}` — thiếu thì Qwen3 sinh khối `<think>` rất dài và chậm.
2. `temperature: 0` cho mọi stage phán xét (`checklist_review`, `field_validation`).
3. Guided JSON qua `response_format: {"type": "json_schema", ...}` — đã xác minh chạy đúng. **Không** parse JSON bằng regex, **không** "hy vọng model trả đúng format".

Embedding và rerank là **TEI native API** (`/embed`, `/rerank`), không phải OpenAI-style. Xem `infra/embed_client.py`.

---

## 5. Quy ước code

| Hạng mục | Quy ước |
|---|---|
| Python | 3.12, type hint đầy đủ, `from __future__ import annotations` |
| Format / lint | `ruff` (line length 100) |
| Đặt tên DB | `snake_case`; API serialize sang `camelCase` để khớp `frontend/src/lib/types.ts` |
| Tiền tệ | `numeric(18,2)` — **không dùng float** |
| Thời gian | `timestamptz`, luôn UTC |
| Exception | Ném `AppError` của `domain/errors.py`; tầng API đổi sang RFC 9457 |
| Log | JSON có `trace_id`. **Cấm log nội dung điều khoản** — chỉ log `permId`, `paraId`, độ dài, hash |
| Comment trong code | Tiếng Việt cho phần giải thích *vì sao*; tên định danh tiếng Anh. Chỉ comment chỗ không hiển nhiên |
| Test | `pytest`. Mỗi bug sửa xong phải có 1 test chặn nó tái diễn |

### Đặc thù xử lý OOXML

- Namespace luôn qua `qn()` của helper, không viết chuỗi `"{http://...}p"` thẳng.
- Khi ghi `w:t`, **luôn** đặt `xml:space="preserve"` — thiếu là mất khoảng trắng, và cú pháp marker eContract có khoảng trắng.
- **Không đụng attribute của `w:p`** khi ghi nội dung. `w14:paraId` phải sống sót, nếu không toàn bộ comment mồ côi.
- Kế thừa `w:rPr` của run đầu tiên trong vùng, `deepcopy`, không tự chế định dạng.
- Parse XML với `resolve_entities=False, no_network=True` (chống XXE); giải nén `.docx` có giới hạn kích thước và số entry (chống zip bomb).

---

## 6. Dữ liệu tạm trong vòng này — đừng nhầm là đã xong

| Thứ | Trạng thái |
|---|---|
| Checklist trong `seed` | **Tôi tự soạn 8–10 clause mẫu**, KHÔNG phải chuẩn pháp lý. Chờ Legal cung cấp bản thật |
| Template | File `HOP DONG MUA XE VAN - VINH TƯƠNG...docx` là hợp đồng đã điền, **không phải mẫu trắng**. Chờ Legal 2–3 template thật |
| Điểm số | Công thức đúng và giải thích được, nhưng **con số vô nghĩa về nghiệp vụ** cho tới khi có checklist thật |
| `self_confidence` | Chưa hiệu chuẩn (`breakdown.calibrated = false`) — cần golden set |
| Auth | Username/password tạm, bọc sau `AuthProvider` để đổi sang SSO mà không sửa nghiệp vụ |

---

## 7. Việc không làm trong vòng này

Có chỗ sẵn trong kiến trúc, nhưng chưa implement — đừng tưởng bị bỏ sót:

marker ký số · tích hợp eContract · comment 2 chiều (TH1) · track changes (TH2) · reupload PT3 · cấu hình checklist trên UI · SSE realtime · editor nhúng.

---

## 8. Kiểm chứng trước khi báo xong

Đừng báo "đã xong" khi chưa chạy. Tối thiểu:

```bash
make lint && make test
```

Với thay đổi chạm `services/document/`: **bắt buộc** thêm `make test-fx` và xác nhận `diff_outside()` trả rỗng.

Với thay đổi chạm `services/ai/`: chạy lại `make check-models` để chắc endpoint còn sống, vì test AI phụ thuộc service ngoài.

Nếu test đỏ, nói rõ đỏ ở đâu kèm output — không im lặng bỏ qua, không sửa test cho xanh.
