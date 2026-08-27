"use client";

/**
 * Tab «Template» của Legal.
 *
 * Đây là **cổng chặn** của mô hình an toàn, không phải một màn CRUD thường:
 * template đăng ký ở đây là bản chuẩn để đối chiếu mọi file Purchasing tải lên.
 * Không có nó, hệ thống không biết vùng nào đáng ra phải khoá — và một file đã
 * bị gỡ Restrict Editing sẽ được coi là mở toàn bộ.
 *
 * Nên luồng cố ý là **soi trước, đăng ký sau**: chọn file → xem kết quả kiểm
 * định → nếu đạt mới cho bấm Đăng ký.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSearch,
  Loader2,
  Save,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listContractNames,
  listTemplates,
  lintTemplate,
  registerTemplate,
  setTemplateFieldLabels,
} from "@/lib/services/reviews";
import { downloadFile } from "@/lib/api";
import type { ContractNameOption } from "@/lib/domain/form-lists";
import type { ContractTemplateInfo, TemplateLintResult } from "@/lib/domain/types";

/** Vùng hệ thống KHÔNG ghi được — chỉ chú thích (chế độ C của TS-04). */
const ANNOTATION_ONLY = new Set(["empty", "cross_table"]);

const KIND_LABEL: Record<string, string> = {
  atomic_field: "Ô giá trị",
  block_region: "Khối văn bản",
  cross_table: "Bắc qua bảng",
  empty: "Rỗng",
};

export function TemplatesPanel() {
  const [names, setNames] = useState<ContractNameOption[]>([]);
  const [templates, setTemplates] = useState<ContractTemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [contractNameId, setContractNameId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lint, setLint] = useState<TemplateLintResult | null>(null);
  const [busy, setBusy] = useState<"lint" | "register" | "labels" | null>(null);

  const [selected, setSelected] = useState<ContractTemplateInfo | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      const [n, t] = await Promise.all([listContractNames(), listTemplates()]);
      setNames(n);
      setTemplates(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = useMemo(
    () => templates.filter((t) => t.isActive),
    [templates]
  );
  const nameLabel = useCallback(
    (id: string) => names.find((n) => n.id === id)?.label || id,
    [names]
  );

  const runLint = async (picked: File) => {
    setBusy("lint");
    setLint(null);
    setError(null);
    try {
      setLint(await lintTemplate(picked));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đọc được tệp");
    } finally {
      setBusy(null);
    }
  };

  const register = async () => {
    if (!file || !contractNameId) return;
    setBusy("register");
    setError(null);
    try {
      const row = await registerTemplate(contractNameId, file);
      setNotice(
        `Đã đăng ký ${nameLabel(contractNameId)} — bản v${row.version}, ${row.openRegionCount} vùng mở`
      );
      setFile(null);
      setLint(null);
      await reload();
      setSelected(row);
      setLabels(row.fieldLabels || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng ký không thành công");
    } finally {
      setBusy(null);
    }
  };

  const saveLabels = async () => {
    if (!selected) return;
    setBusy("labels");
    try {
      const row = await setTemplateFieldLabels(
        selected.id,
        Object.fromEntries(
          Object.entries(labels).filter(([, v]) => v.trim())
        )
      );
      setSelected(row);
      setNotice("Đã lưu tên nghiệp vụ cho các vùng mở");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu không thành công");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Đăng ký template</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Mỗi lần đăng ký là một <strong>version mới</strong>. Bản cũ không bị xoá —
          hợp đồng đang chạy vẫn trỏ vào version của nó.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Tên hợp đồng</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
              value={contractNameId}
              onChange={(e) => setContractNameId(e.target.value)}
            >
              <option value="">— Chọn —</option>
              {names.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Tệp .docx</Label>
            <Input
              type="file"
              accept=".docx"
              className="mt-1 h-9"
              onChange={(e) => {
                const picked = e.target.files?.[0] || null;
                setFile(picked);
                if (picked) void runLint(picked);
              }}
            />
          </div>
        </div>

        {busy === "lint" && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm định…
          </p>
        )}

        {lint && <LintReport lint={lint} />}

        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            disabled={!file || !contractNameId || busy !== null || !lint?.acceptable}
            onClick={register}
          >
            {busy === "register" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1 h-3.5 w-3.5" />
            )}
            Đăng ký
          </Button>
          {lint && !lint.acceptable && (
            <span className="text-xs text-destructive">
              Tệp chưa đạt — xem phần kiểm định ở trên
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">
          Template đang hiệu lực ({active.length})
        </h3>
        {active.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Chưa có template nào. Loại hợp đồng chưa đăng ký template thì file
            upload <strong>không được đối chiếu cấu trúc</strong>.
          </p>
        )}
        <div className="mt-3 space-y-2">
          {active.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setSelected(t);
                setLabels(t.fieldLabels || {});
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm ${
                selected?.id === t.id ? "border-sky-500 bg-sky-50" : "hover:bg-muted/40"
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium">{nameLabel(t.contractNameId)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  v{t.version} · {t.openRegionCount} vùng mở ·{" "}
                  {t.lockedParagraphCount} đoạn khoá · {t.fileName}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {t.protectionEffective ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Có khoá
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">
                    Không khoá
                  </Badge>
                )}
                {/* Không dùng <a href> — endpoint file kiểm quyền bằng Bearer
                    token, mà link trần không gửi được header nên luôn 401. */}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  title="Tải template"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadFile(t.downloadUrl, t.fileName).catch((err) =>
                      setError(
                        err instanceof Error
                          ? `Không tải được template: ${err.message}`
                          : "Không tải được template"
                      )
                    );
                  }}
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <section className="rounded-lg border p-4">
          <h3 className="text-sm font-semibold">
            Tên nghiệp vụ cho vùng mở — {nameLabel(selected.contractNameId)} v
            {selected.version}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Mã vùng do Word sinh là <strong>số ngẫu nhiên không có tên</strong>. Đặt
            tên ở đây thì Purchasing thấy &ldquo;Giá trị Hợp Đồng&rdquo; thay vì
            &ldquo;Vùng mở #7&rdquo;, và AI biết vùng đó là điều khoản gì.
          </p>

          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {selected.regions.map((r) => {
              const annotationOnly = ANNOTATION_ONLY.has(r.regionKind);
              return (
                <div key={r.permId} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    #{r.ordinal} · {KIND_LABEL[r.regionKind] || r.regionKind}
                  </span>
                  <Input
                    className="h-8 flex-1"
                    placeholder={
                      annotationOnly
                        ? "Vùng này hệ thống không ghi được — chỉ chú thích"
                        : `Tên nghiệp vụ cho ${r.permId}`
                    }
                    value={labels[r.permId] ?? r.label ?? ""}
                    onChange={(e) =>
                      setLabels((prev) => ({ ...prev, [r.permId]: e.target.value }))
                    }
                  />
                  {annotationOnly && (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  )}
                </div>
              );
            })}
          </div>

          <Button
            size="sm"
            className="mt-3"
            disabled={busy !== null}
            onClick={saveLabels}
          >
            {busy === "labels" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 h-3.5 w-3.5" />
            )}
            Lưu tên vùng
          </Button>
        </section>
      )}
    </div>
  );
}

function LintReport({ lint }: { lint: TemplateLintResult }) {
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileSearch className="h-4 w-4" />
        Kết quả kiểm định
        {lint.acceptable ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <CheckCircle2 className="h-3 w-3" /> Đạt
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-[10px]">
            Không đạt
          </Badge>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
        <Stat label="Cơ chế khoá" value={lint.mechanism} />
        <Stat
          label="Restrict Editing"
          value={lint.protectionEffective ? "có hiệu lực" : "KHÔNG hiệu lực"}
        />
        <Stat
          label="Vùng mở"
          value={`${lint.writableRegionCount}/${lint.openRegionCount} ghi được`}
        />
        <Stat label="Đoạn khoá" value={String(lint.lockedParagraphCount)} />
      </dl>

      {lint.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {lint.issues.map((i, index) => (
            <li key={`${i.type}-${index}`} className="flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                <strong>{i.location}</strong> — {i.diff_preview || i.type}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
