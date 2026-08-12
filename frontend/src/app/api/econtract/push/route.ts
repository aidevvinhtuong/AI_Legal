import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import type { ContractReview } from "@/lib/types";
import { buildEcontractPayload, validateMarkers } from "@/lib/econtract-flow";
import { prepareEcontractFileBase64 } from "@/lib/econtract-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushBody = {
  reviewId?: string;
  review: ContractReview;
  /** TK + MK user đang login AI Legal → body login FPT.eContract */
  username?: string;
  password?: string;
};

async function loadDocxBytes(review: ContractReview): Promise<Buffer> {
  const rel =
    review.reviewedDocxUrl ||
    review.originalDocxUrl ||
    "/samples/Template_HDDV_chung_2026.docx";

  if (rel.startsWith("http://") || rel.startsWith("https://")) {
    const res = await fetch(rel);
    if (!res.ok) throw new Error(`Không tải được file: ${rel}`);
    return Buffer.from(await res.arrayBuffer());
  }

  if (rel.startsWith("blob:")) {
    throw new Error(
      "File đang ở blob URL trình duyệt — hãy dùng file mẫu /samples hoặc upload lại trước khi đẩy eContract"
    );
  }

  const clean = rel.replace(/^\//, "");
  const abs = path.join(process.cwd(), "public", clean);
  try {
    return await fs.readFile(abs);
  } catch {
    const fallback = path.join(
      process.cwd(),
      "public/samples/Template_HDDV_chung_2026.docx"
    );
    return fs.readFile(fallback);
  }
}

async function econtractLogin(
  root: string,
  username: string,
  password: string
) {
  const clientid = process.env.ECONTRACT_CLIENT_ID;
  const clientsecret = process.env.ECONTRACT_CLIENT_SECRET;
  if (!clientid || !clientsecret) {
    throw new Error(
      "Thiếu cấu hình eContract: ECONTRACT_CLIENT_ID / ECONTRACT_CLIENT_SECRET trong .env.local"
    );
  }
  if (!username?.trim() || !password) {
    throw new Error(
      "Thiếu username/password user login để xác thực FPT.eContract"
    );
  }
  const res = await fetch(`${root.replace(/\/$/, "")}/v1/client-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, clientid, clientsecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.message ||
        `Login eContract thất bại (HTTP ${res.status})`
    );
  }
  return data.access_token as string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PushBody;
    const review = body.review;
    if (!review?.id || !review.recipients) {
      return NextResponse.json(
        { ok: false, message: "Thiếu review trong request" },
        { status: 400 }
      );
    }

    const markerErrors = validateMarkers(review.recipients);
    if (markerErrors.length) {
      return NextResponse.json(
        { ok: false, message: markerErrors[0] },
        { status: 400 }
      );
    }

    const root =
      process.env.ECONTRACT_ROOT_URL ||
      "https://demo.econtract.fpt.com/app";

    const docxBytes = await loadDocxBytes(review);
    const prepared = await prepareEcontractFileBase64(
      docxBytes,
      review.recipients,
      review.fileName || "contract.docx"
    );

    const selector = process.env.ECONTRACT_SELECTOR;
    const docTypeCode = process.env.ECONTRACT_DOC_TYPE_CODE
      ? Number(process.env.ECONTRACT_DOC_TYPE_CODE)
      : undefined;

    const payload = buildEcontractPayload(review, prepared.base64, {
      selector,
      docTypeCode: docTypeCode ?? null,
    });
    payload.body.fileName = prepared.fileName;

    const token = await econtractLogin(
      root,
      body.username || "",
      body.password || ""
    );
    const excallUrl = `${root.replace(/\/$/, "")}/services/excall/api/excall`;
    const ecRes = await fetch(excallUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const ecJson = await ecRes.json().catch(() => ({}));

    const code = ecJson.code ?? ecJson.error;
    const ok = String(code) === "0" || code === 0;
    const response = ecJson.response || {};
    const econtract = {
      envelopeId: response.envelopeId || response.envId,
      envStatus: "Processing",
      code,
      message: ecJson.message || ecJson.error_description || "",
      urlIndividual: response.urlIndividual,
      fileMode: prepared.mode,
      pushedAt: new Date().toISOString(),
      raw: ecJson,
      error: ok ? undefined : ecJson.message || "eContract trả lỗi",
      note: prepared.note,
    };

    if (!ok) {
      return NextResponse.json(
        {
          ok: false,
          message:
            econtract.message ||
            `eContract lỗi code=${code}`,
          econtract,
          payloadPreview: { ...payload, body: { ...payload.body, file: `[base64 ${prepared.mode} ${prepared.base64.length} chars]` } },
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: prepared.note
        ? `Đã tạo envelope trên eContract (${prepared.note})`
        : "Đã tạo envelope trên eContract",
      econtract,
      payloadPreview: {
        ...payload,
        body: {
          ...payload.body,
          file: `[base64 ${prepared.mode} ${prepared.base64.length} chars]`,
        },
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
