/**
 * Luồng nghiệp vụ chính, đi hết từ tạo tài liệu tới đẩy eContract.
 *
 * ## Bộ này canh cái gì
 *
 * Luồng ở CLAUDE.md §1 là một **máy trạng thái**, và cho tới giờ không có gì
 * kiểm nó ở phía frontend: mỗi hàm trong `review-service` được kiểm bằng mắt,
 * còn thứ tự và điều kiện chuyển trạng thái thì không ai kiểm. Vừa gỡ 4.724
 * dòng mock khỏi chính những hàm này mà chỗ dựa duy nhất là `tsc` — tức là chỉ
 * biết kiểu đúng, không biết hành vi đúng.
 *
 * Cụ thể, bốn thứ dễ hỏng mà không ném exception:
 *
 *  - **Sai động từ / sai payload.** `decision: "approve"` với `"reject"` cùng
 *    kiểu `string`, cùng qua `tsc`, mà một cái đẩy ticket sang Legal còn cái kia
 *    trả về Purchasing.
 *  - **Mất `If-Match`.** Không có nó thì hai tab ghi đè nhau im lặng (§5.6).
 *    Không có gì đỏ lên; chỉ có dữ liệu mất.
 *  - **Cổng chặn marker thủng.** Ràng buộc C-8 + bảng mã lỗi FPT: thiếu marker
 *    thì *không được* gọi lên FPT. Nếu cổng này lọt, lỗi hiện ra ở phía FPT chứ
 *    không phải ở đây.
 *  - **Rò credentials.** Bản demo cũ POST mật khẩu người dùng kèm mỗi lần đẩy
 *    eContract. Đã bỏ, và test dưới đây chốt để nó không quay lại.
 *
 * ## Vì sao giả lập ở tầng `fetch`
 *
 * Xem `src/test/http-recorder.ts`. Tóm tắt: mọi thứ `api.ts` làm đều là hành vi
 * cần kiểm, nên không giả lập đè lên nó.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { HttpRecorder } from "@/test/http-recorder";
import type { ContractReview, DocumentIntakeMeta, SignRecipient } from "@/lib/domain/types";
import { setSession } from "@/lib/auth/session";
import {
  completeMarkersAndPushEcontract,
  createReview,
  legalDecide,
  managerDecide,
  saveFields,
  submitDraftToQueue,
  submitToLegal,
  validateMarkers,
} from "@/lib/services/reviews";

const REVIEW_ID = "rev_1";

const INTAKE: DocumentIntakeMeta = {
  documentCategoryId: "capex",
  documentCategoryLabel: "CAPEX",
  documentName: "Mua xe vận tải",
  documentNumber: "",
  contractNameId: "cn_capex_capex_vehicle",
  businessEntityId: "be_vts",
  contractValue: "685000000",
} as DocumentIntakeMeta;

/** Review giả ở một trạng thái bất kỳ — chỉ đủ trường cho đường đang test. */
function review(patch: Partial<ContractReview> = {}): Partial<ContractReview> {
  return {
    id: REVIEW_ID,
    status: "draft",
    rowVersion: 7,
    intake: INTAKE,
    recipients: [],
    ...patch,
  };
}

/** Người ký hợp lệ đủ để qua `validateMarkers`. */
function signer(patch: Partial<SignRecipient> = {}): SignRecipient {
  return {
    id: "p_001_r_001",
    name: "Nguyễn Văn A",
    role: "company",
    partyId: "p_001",
    orgName: "Vinh Tuong Saint-Gobain",
    isMyOrg: true,
    order: 1,
    email: "a@sgvn.example",
    phone: "",
    ecRole: "signer",
    signType: "sign_fca.passcode",
    markerType: "ds",
    marker: { id: "p_001_r_001", type: "ds", height: 100, positionLabel: "Khối ký" },
    ...patch,
  } as SignRecipient;
}

let http: HttpRecorder;

beforeEach(() => {
  http = new HttpRecorder();
  http.install();
  setSession({
    token: "tok_abc",
    userId: "u_pur",
    username: "van.a",
    name: "Nguyễn Văn A",
    role: "purchasing",
    department: "Purchasing",
    permissions: [],
  } as never);
});

describe("Purchasing tạo tài liệu", () => {
  it("đường chính instantiate từ template — KHÔNG gửi file người dùng", async () => {
    http.on("POST", /\/reviews$/, () => ({ json: review() }));

    await createReview({
      contractTypeId: "ct_standard",
      title: "HĐ mua xe",
      files: [],
      intake: INTAKE,
      fromTemplate: true,
    });

    const req = http.find("POST", "/api/v1/reviews")!;
    const form = req.body as FormData;
    expect(form.get("from_template")).toBe("true");
    // Đường template không nhận file: có file nghĩa là kiểm kê vùng mở/khoá
    // không còn tin cậy tuyệt đối được nữa (§5.1).
    expect(form.get("files")).toBeNull();
  });

  it("đường upload không kèm file thì chặn tại chỗ, không gọi mạng", async () => {
    await expect(
      createReview({
        contractTypeId: "ct_standard",
        title: "HĐ mua xe",
        files: [],
        intake: INTAKE,
      })
    ).rejects.toThrow(/Cần tải lên một file/);

    expect(http.requests).toHaveLength(0);
  });

  it("chặn upload nhiều hơn một file hợp đồng review", async () => {
    const docx = (name: string) => new File(["x"], name);
    await expect(
      createReview({
        contractTypeId: "ct_standard",
        title: "HĐ",
        files: [docx("a.docx"), docx("b.docx")],
        intake: INTAKE,
      })
    ).rejects.toThrow(/chỉ được upload 1 file/);

    expect(http.requests).toHaveLength(0);
  });
});

describe("ghi vùng mở", () => {
  it("gửi If-Match từ rowVersion — chống hai tab ghi đè nhau", async () => {
    http.on("PUT", /\/fields$/, () => ({ json: review({ rowVersion: 8 }) }));

    await saveFields(REVIEW_ID, [], 7);

    const req = http.find("PUT", "/fields")!;
    expect(req.headers["if-match"]).toBe('"7"');
    expect(req.headers["authorization"]).toBe("Bearer tok_abc");
  });

  it("không có rowVersion thì KHÔNG bịa header — để backend tự quyết", async () => {
    http.on("PUT", /\/fields$/, () => ({ json: review() }));

    await saveFields(REVIEW_ID, []);

    expect(http.find("PUT", "/fields")!.headers["if-match"]).toBeUndefined();
  });
});

describe("luồng duyệt", () => {
  it("submit → manager approve → legal approve đi đúng thứ tự và đúng endpoint", async () => {
    http.on("POST", /\/submit$/, () => ({ json: review({ status: "pending_manager" }) }));
    http.on("POST", /\/manager-decide$/, () => ({ json: review({ status: "pending_legal" }) }));
    http.on("POST", /\/legal-decision$/, () => ({ json: review({ status: "pending_markers" }) }));

    await submitToLegal(REVIEW_ID);
    await managerDecide(REVIEW_ID, "approve", "OK");
    await legalDecide(REVIEW_ID, "approve");

    expect(http.trace()).toEqual([
      `POST /api/v1/reviews/${REVIEW_ID}/submit`,
      `POST /api/v1/reviews/${REVIEW_ID}/manager-decide`,
      `POST /api/v1/reviews/${REVIEW_ID}/legal-decision`,
    ]);
  });

  it("reject gửi đúng decision + comment (A4b: yêu cầu chỉnh = phải Từ chối)", async () => {
    http.on("POST", /\/manager-decide$/, () => ({ json: review({ status: "rejected" }) }));

    await managerDecide(REVIEW_ID, "reject", "Sửa lại điều 4");

    expect(http.find("POST", "/manager-decide")!.body).toEqual({
      decision: "reject",
      comment: "Sửa lại điều 4",
    });
  });

  it("legal reject mang theo feedback có cấu trúc", async () => {
    http.on("POST", /\/legal-decision$/, () => ({ json: review({ status: "rejected" }) }));

    const feedback = [{ id: "f1", section: "Điều 4", note: "Số tiền bằng chữ sai" }];
    await legalDecide(REVIEW_ID, "reject", feedback as never);

    expect(http.find("POST", "/legal-decision")!.body).toEqual({
      decision: "reject",
      feedback,
    });
  });

  /**
   * Hai động từ dễ nhầm nhau, và nhầm là hỏng luồng chứ không đỏ ở đâu cả:
   * `/retry-ai` đẩy tài liệu vào hàng đợi AI, `/submit` trình lên người duyệt.
   * Cả hai đều là POST không body, cùng trả về `ContractReview`.
   */
  it("đưa draft vào hàng đợi AI dùng /retry-ai, KHÔNG phải /submit", async () => {
    http.on("POST", /\/retry-ai$/, () => ({ json: review({ status: "queued" }) }));

    const result = await submitDraftToQueue(REVIEW_ID);

    expect(result.status).toBe("queued");
    expect(http.trace()).toEqual([`POST /api/v1/reviews/${REVIEW_ID}/retry-ai`]);
  });
});

describe("cổng chặn marker trước khi đẩy eContract", () => {
  it("thiếu marker → dừng ở client, KHÔNG gọi push", async () => {
    const noMarker = signer({ marker: undefined });
    http.on("GET", /\/reviews\/rev_1$/, () => ({
      json: review({ status: "pending_markers", recipients: [noMarker] }),
    }));

    await expect(completeMarkersAndPushEcontract(REVIEW_ID)).rejects.toThrow(
      /isNotExistsMarkerField/
    );

    // Chỉ được phép có đúng lời gọi đọc review; không có push nào lọt qua.
    expect(http.trace()).toEqual([`GET /api/v1/reviews/${REVIEW_ID}`]);
  });

  it("sai trạng thái → dừng, KHÔNG gọi push", async () => {
    http.on("GET", /\/reviews\/rev_1$/, () => ({
      json: review({ status: "pending_legal", recipients: [signer()] }),
    }));

    await expect(completeMarkersAndPushEcontract(REVIEW_ID)).rejects.toThrow(
      /không ở trạng thái chờ gán chữ ký/
    );
    expect(http.trace()).toEqual([`GET /api/v1/reviews/${REVIEW_ID}`]);
  });

  it("đủ điều kiện → kiểm ma trận ký ở server rồi mới push", async () => {
    http.on("GET", /\/reviews\/rev_1$/, () => ({
      json: review({ status: "pending_markers", recipients: [signer()] }),
    }));
    http.on("POST", /\/signing-rules\/preview$/, () => ({
      json: { ready: true, reason: null, bandLabel: "≥ 500.000.000", recipients: [] },
    }));
    http.on("POST", /\/econtract\/push$/, () => ({
      json: review({ status: "syncing_econtract" }),
    }));

    const result = await completeMarkersAndPushEcontract(REVIEW_ID);

    expect(result.status).toBe("syncing_econtract");
    expect(http.trace()).toEqual([
      `GET /api/v1/reviews/${REVIEW_ID}`,
      "POST /api/v1/signing-rules/preview",
      `POST /api/v1/reviews/${REVIEW_ID}/econtract/push`,
    ]);
  });

  it("ma trận ký không khớp → báo đúng lý do server trả, KHÔNG push", async () => {
    http.on("GET", /\/reviews\/rev_1$/, () => ({
      json: review({ status: "pending_markers", recipients: [signer()] }),
    }));
    http.on("POST", /\/signing-rules\/preview$/, () => ({
      json: {
        ready: false,
        reason: "Ma trận khớp điều kiện nhưng thiếu người Ký chính",
        bandLabel: "",
        recipients: [],
      },
    }));

    await expect(completeMarkersAndPushEcontract(REVIEW_ID)).rejects.toThrow(
      /thiếu người Ký chính/
    );
    expect(http.trace()).not.toContain(
      `POST /api/v1/reviews/${REVIEW_ID}/econtract/push`
    );
  });

  it("push KHÔNG mang theo credentials của người dùng", async () => {
    http.on("GET", /\/reviews\/rev_1$/, () => ({
      json: review({ status: "pending_markers", recipients: [signer()] }),
    }));
    http.on("POST", /\/signing-rules\/preview$/, () => ({
      json: { ready: true, reason: null, bandLabel: "", recipients: [] },
    }));
    http.on("POST", /\/econtract\/push$/, () => ({
      json: review({ status: "syncing_econtract" }),
    }));

    await completeMarkersAndPushEcontract(REVIEW_ID);

    // Credentials FPT thuộc về server (đọc từ .env). Bản demo cũ gửi kèm mật
    // khẩu đăng nhập của người dùng mỗi lần đẩy — chốt để không tái diễn.
    const body = JSON.stringify(http.find("POST", "/econtract/push")!.body ?? {});
    expect(body).not.toMatch(/password|username|passcode/i);
  });
});

describe("luật marker của FPT (bảng mã lỗi §9)", () => {
  it("người xem xét không được gán marker", () => {
    const reviewer = signer({
      ecRole: "reviewer",
      signType: "review",
      markerType: "ds",
    });
    expect(validateMarkers([reviewer]).join(" ")).toMatch(/wrongFieldWithRole/);
  });

  it("trùng marker id bị bắt — id phải duy nhất toàn file (C-8)", () => {
    const a = signer();
    const b = signer({ id: "p_001_r_002", name: "Trần B", email: "b@sgvn.example" });
    expect(validateMarkers([a, b]).join(" ")).toMatch(/Trùng marker id/);
  });

  it("thiếu email → đúng mã lỗi FPT, không phải câu chung chung", () => {
    expect(validateMarkers([signer({ email: "" })]).join(" ")).toMatch(
      /isNotExistsRecipientInfo/
    );
  });

  it("bộ người ký hợp lệ thì không sinh lỗi nào", () => {
    expect(validateMarkers([signer()])).toEqual([]);
  });
});
