# CLAUDE.md — Quy ước làm việc trong `backend/`

> Dự án: **AI Legal** — Hệ thống AI Review Hợp đồng, Saint-Gobain Việt Nam.
> Thiết kế đầy đủ ở [`docs/technical-solution/`](../docs/technical-solution/). Kế hoạch vòng hiện tại: [`TS-12`](../docs/technical-solution/TS-12-implementation-plan.md).
> File này là **quy ước khi viết code**, không lặp lại thiết kế.

---

## 1. Bất biến — vi phạm là lỗi nghiêm trọng

Những điều dưới đây không có ngoại lệ, không có cờ tắt, không "tạm thời bỏ qua để test".
B1* là các biến thể của cùng một nguyên tắc: **chỉ có đúng một đường ghi tài liệu, và nó luôn đi qua allow-list.**

| # | Bất biến | Nơi thực thi |
|---|----------|--------------|
| **B1** | **Không byte nào trong vùng khoá của hợp đồng được thay đổi.** Kể cả khi LLM bị lừa, frontend bị bypass, hay user cố tình | `services/document/allowlist.py` (lọc trước) + `postcheck.py` (kiểm sau). Cả hai đều bắt buộc chạy |
| **B1b** | **Chèn marker ký số KHÔNG được sửa file gốc.** Marker là ghi vào vùng khoá, nên chỉ tồn tại trên một **bản xuất bản** riêng (`ReviewFile(kind="econtract")`) | `services/document/marker.py` → `assert_marker_only()`: bản xuất bản khác bản gốc đúng ở các đoạn marker, không hơn |
| **B1c** | **Chat KHÔNG ghi tài liệu.** Nó sinh `ai_proposals`; chấp nhận thì đi qua `save_fields()` — đúng một đường ghi, đúng một lần qua allow-list | `services/review/chat.py` |
| **B1d** | **Yêu cầu nhắm ra ngoài vùng mở bị từ chối TRƯỚC khi gọi LLM.** Gọi rồi mới lọc nghĩa là mô hình đã sinh văn bản thay thế cho điều khoản pháp lý, và nó sẽ nằm trong log | `services/ai/chat.py::run` |
| **B1e** | **Vùng đích của track changes do SERVER giải, không nhận từ trình duyệt.** FE chỉ gửi `paraId`; backend tra `document_fields` để biết đoạn đó thuộc vùng mở nào. Cho client tự khai vùng đích là mở thẳng đường bypass | `services/review/legal_edits.py::resolve_target` |
| **B2** | **LLM không bao giờ sinh ra con số điểm.** Hai điểm số do `services/ai/scorer.py` tính bằng code, deterministic | `scorer.py`; prompt `ai_summary_fairness` cấm tường minh |
| **B3** | **Không hardcode nội dung pháp lý** (số ngày, %, tên điều khoản, ngưỡng) trong code hoặc prompt. Nó thuộc Legal, nằm ở bảng `checklist_clauses` | CI `scripts/validate-prompts.js` + grep trong CI |
| **B4** | **RBAC enforce ở tầng repository**, không phải ở router. Router quên kiểm thì vẫn an toàn | `domain/rbac.py` + mệnh đề `WHERE` trong repository |

Khi sửa code chạm vào các vùng này, phải có test đi kèm chứng minh bất biến còn nguyên.

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
| Frontend | 3001 |
| PostgreSQL | 55432 |
| Redis | 63790 |
| MinIO API / Console | 9100 / 9101 |

Service `worker` và `beat` không mở cổng nào.

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

### Phiên đăng nhập: idle + absolute + cảnh báo

Mô hình chuẩn cho ứng dụng nội bộ có dữ liệu nhạy cảm (OWASP Session Management),
đúng cái ngân hàng và ERP dùng. **Ba lớp, đừng bỏ lớp nào:**

| Lớp | Giá trị | Ai giữ |
|---|---|---|
| Hạn token | `ACCESS_TOKEN_MINUTES` = 30 | server |
| Idle timeout | = hạn token, gia hạn CHỈ khi có thao tác | client |
| Trần tuyệt đối | `REFRESH_TOKEN_HOURS` = 8 kể từ lần nhập mật khẩu | **server** |

`POST /auth/refresh` cấp token mới khi token hiện tại còn hiệu lực. FE gọi ở ~75%
tuổi thọ **và chỉ khi có thao tác thật** kể từ lần gia hạn trước
(`lib/session-keepalive.ts`). Gia hạn theo bộ hẹn giờ đơn thuần là sai: máy trạm
bỏ quên mở tab sẽ sống tới hết trần.

Trần tuyệt đối mang trong claim `lgn` và **giữ nguyên qua mọi lần gia hạn**. Cấp
lại `lgn` theo thời điểm hiện tại là làm trần biến mất hoàn toàn — mà mọi test
"gia hạn được" vẫn xanh, nên lỗi đó sẽ không ai thấy. Có test riêng chốt.

**Mọi mốc tính từ `exp` của token, không nuôi đồng hồ idle riêng.** Hai đồng hồ
sẽ trôi lệch và tạo ra ca tệ nhất: hộp cảnh báo hiện ra *sau khi* token đã chết,
người dùng bấm "Tôi vẫn đang làm việc" và nhận lỗi.

Vì sao phải cảnh báo chứ không hết phiên im lặng: quy tắc **A4c** bắt lưu thủ
công, nên mất phiên là **mất trắng phần chưa lưu**.

Ranh giới tin cậy: chính sách idle ở client là **cố ý** — nó là chuyện trải
nghiệm, và người dùng giả vờ hoạt động thì họ chính là người đang ngồi đó. Thứ
không giả được là trần tuyệt đối, do server giữ.

Kiểm dòng thời gian: `make test-fe`. Phần quyết định là hàm thuần `nextAction`
nên diễn lại được cả 30 phút trong vài mili-giây, không phải ngồi chờ.

### Đánh thức Celery worker

**Luôn qua `infra.db.on_commit(db, ...)`, không bao giờ gọi `task.delay()` thẳng
trong request.** Worker nhận job trong vài mili-giây và sẽ truy vấn bản ghi mà
transaction chưa commit — job kết thúc im lặng với `{"status": "missing"}`. Đã
đo được trên máy dev, không phải rủi ro lý thuyết.

Redis chết thì hàm `enqueue_*` trả `None` chứ không ném; bản ghi vẫn nằm trong
DB và task định kỳ (`ai.drain`, `econtract.drain`) vớt lại. Hai task đó chạy
bằng service `beat` — thiếu nó là mất lưới an toàn.

### "Version hiện tại" có HAI nghĩa, đừng trộn

`services/review/versions.py`:

* `latest()` — version số lớn nhất, kể cả version **không mang tệp**. Dùng để
  đánh số vòng duyệt.
* `current_document()` — version mới nhất **CÓ tệp**. Mọi thao tác đọc/ghi tài
  liệu phải bám vào cái này.

Từ chối cũng bump version. Trước đây nó ghi `file_id = NULL` và bốn module đều
lấy "version số lớn nhất", nên sau mỗi lần Từ chối: `fields` về rỗng trên UI,
`save_fields()` ném `missing_file` (**Purchasing hết sửa được, đúng lúc cần sửa
nhất**), bình luận mồ côi hàng loạt. Đã sửa hai tầng — `decide()` mang tệp +
kiểm kê sang version mới, và `current_document()` bỏ qua version không tệp.

### Text của trình soạn thảo phải khớp CHÍNH XÁC text đọc từ OOXML

`run_text()` trong `services/document/ooxml.py` quy `w:tab` → `"\t"` và
`w:br`/`w:cr` → `"\n"`. SuperDoc dựng chúng thành node riêng (`tab`,
`hardBreak`) có text rỗng, nên FE phải bù lại — xem `NODE_AS_TEXT` trong
`frontend/src/components/review/superdoc-embed.tsx`.

Thiếu bù thì đề xuất TH2 hỏng: SHA-256 của `before` không khớp, và tệ hơn là
**offset lệch** nên mẩu sửa bị ghi sai chỗ bên trong vùng mở. Đo được: 16/197
đoạn template HDDV và 61/230 đoạn hợp đồng THACO lệch vì đúng lý do này.

`./scripts/check-editor-text-parity.sh` đối chiếu hai bên trên `.docx` thật.
**Chạy lại mỗi khi nâng cấp `@harbour-enterprises/superdoc`.**

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
| Checklist | **`seed.py` KHÔNG tạo checklist nào.** Trong DB dev nó chỉ tồn tại như tác dụng phụ của `tests/integration/test_m2_flow.py`, và là điều khoản bịa để test. Chưa có bản thật của Legal — chừng nào chưa có thì mọi kết luận AI đều vô nghĩa về nghiệp vụ |
| Template | File `HOP DONG MUA XE VAN - VINH TƯƠNG...docx` là hợp đồng đã điền, **không phải mẫu trắng**. Chờ Legal 2–3 template thật |
| Điểm số | Công thức đúng và giải thích được, nhưng **con số vô nghĩa về nghiệp vụ** cho tới khi có checklist thật |
| `self_confidence` | Chưa hiệu chuẩn (`breakdown.calibrated = false`) — cần golden set |
| Auth | Username/password tạm, bọc sau `AuthProvider` để đổi sang SSO mà không sửa nghiệp vụ |

---

## 7. Việc không làm trong vòng này

Có chỗ sẵn trong kiến trúc, nhưng chưa implement — đừng tưởng bị bỏ sót:

cấu hình checklist trên UI · ghi `w:comment` vào `.docx` (PA-B — DB đã là nguồn sự thật) · nhận file đã ký về từ FPT (ngoài scope theo C-5) · `trackFormat` (đổi định dạng thuần, backend làm việc trên văn bản nên chưa biểu diễn được).

**Đã xong ở vòng B (24/08/2026):** ràng buộc cấu trúc template + sinh tài liệu
từ template (B2) · chat sửa văn bản PT1 (B1) · comment 2 chiều TH1 (B3) · SSE
trạng thái (B4) · SuperDoc làm trình hiển thị, opt-in bằng `NEXT_PUBLIC_EDITOR=superdoc` (B5).

**Đã xong ở vòng C (26/08/2026):** thanh công cụ + bôi chọn của SuperDoc · neo
bình luận vào đoạn đang chọn · **track changes TH2** (`legal_edits`, vùng đích do
server giải — bất biến B1e) · **reupload PT3** (`POST /reviews/{id}/reupload`, hai
lớp đối chiếu, chặn cứng theo C-4) · **đính kèm TH3** (`ReviewFile(kind="attachment")`,
lưu nội dung thật, KHÔNG đối chiếu cấu trúc — người duyệt có quyền đề nghị sửa cả
vùng khoá).

Năm lỗi phát hiện trong vòng C, đều đã sửa: Từ chối ghi `file_id = NULL` làm mất
tài liệu · text SuperDoc lệch text backend ở `w:tab` · **audit của mọi lần CHẶN
bị rollback xoá** (xem `write_audit_now`) · `asdict()` gửi snake_case cho FE (xem
`FieldStructureIssue.as_payload`) · đính kèm chỉ lưu `{name, size}`, không có nội
dung thật.

**eContract đã làm xong luồng đẩy** (M4) nhưng đang chạy **adapter mock**: chưa có credentials môi trường Demo (câu hỏi mở D1e). Điền 4 biến `ECONTRACT_*` vào `.env` là chuyển sang gọi thật, không phải sửa code. Hai giá trị `ECONTRACT_SELECTOR` / `ECONTRACT_DOC_TYPE_CODE` cũng còn là placeholder (D1a/D1b), và `MARKER_PX_PER_SPACE` **chưa hiệu chuẩn** — phải đo bề rộng ô ký thật trên môi trường Demo (ca EC-07).

---

## 8. Kiểm chứng trước khi báo xong

Đừng báo "đã xong" khi chưa chạy. Tối thiểu:

```bash
make lint && make test
```

Với thay đổi chạm `services/document/`: **bắt buộc** thêm `make test-fx` và xác nhận `diff_outside()` trả rỗng.

Với thay đổi chạm `services/ai/`: chạy lại `make check-models` để chắc endpoint còn sống, vì test AI phụ thuộc service ngoài.

Frontend giờ **có** hạ tầng test: `make test-fe` (vitest + jsdom, chạy trong
container `frontend`). Đụng `lib/` hoặc component nào có test thì chạy nó.

Với thay đổi chạm cách đọc text từ OOXML (`run_text`, `OoxmlReader`) **hoặc** nâng
cấp `@harbour-enterprises/superdoc`: **bắt buộc** `make test-editor-parity`. Hai
bên phải đọc ra cùng một chuỗi ký tự, nếu không thì đề xuất TH2 ghi lệch vị trí.

Nếu test đỏ, nói rõ đỏ ở đâu kèm output — không im lặng bỏ qua, không sửa test cho xanh.
