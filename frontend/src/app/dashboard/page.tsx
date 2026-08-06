"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppLayout from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, STATUS_LABEL } from "@/components/review/status-badge";
import { getSession, listReviews } from "@/lib/review-service";
import type { ContractReview, ReviewAttachment, ReviewStatus } from "@/lib/types";
import { sampleUrl } from "@/lib/mock-data";
import {
  canAccessConfig,
  canAccessConfigurations,
  canCreateContracts,
} from "@/lib/roles";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  Loader2,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const REVIEW_STATUSES = Object.keys(STATUS_LABEL) as ReviewStatus[];

type FilterFieldKey =
  | "status"
  | "category"
  | "contractType"
  | "contractName"
  | "businessEntity"
  | "contractBase";

type ActiveFilter = {
  id: string;
  field: FilterFieldKey;
  value: string;
};

const FILTER_FIELDS: {
  key: FilterFieldKey;
  label: string;
}[] = [
  { key: "status", label: "Trạng thái (Status)" },
  { key: "category", label: "Loại hợp đồng (Contract category)" },
  { key: "contractType", label: "Loại giá trị hợp đồng (Contract value type)" },
  { key: "contractName", label: "Tên hợp đồng (Contract name)" },
  { key: "businessEntity", label: "Công ty (Business Entity)" },
  { key: "contractBase", label: "Hợp đồng tiêu chuẩn (Standard contract)" },
];

function cell(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "—";
  return String(value);
}

function formatDate(value?: string) {
  if (!value) return "—";
  try {
    return format(new Date(value), "dd/MM/yyyy");
  } catch {
    return value;
  }
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  try {
    return format(new Date(value), "dd/MM/yyyy HH:mm");
  } catch {
    return value;
  }
}

function discountLabel(r: ContractReview) {
  const d = r.intake?.hasDiscount;
  if (d === "yes") return "Có";
  if (d === "no") return "Không";
  return "—";
}

function uniqueSorted(values: (string | undefined | null)[]) {
  return Array.from(
    new Set(values.map((v) => (v || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "vi"));
}

function fieldLabel(key: FilterFieldKey) {
  return FILTER_FIELDS.find((f) => f.key === key)?.label || key;
}

function reviewAttachment(r: ContractReview): ReviewAttachment | null {
  if (r.attachments?.[0]) return r.attachments[0];
  const name = r.fileName || r.fileNames?.[0];
  if (!name && !r.originalDocxUrl && !r.reviewedDocxUrl) return null;
  return {
    id: "review",
    fileName: name || "document.docx",
    originalDocxUrl: r.originalDocxUrl || (name ? sampleUrl(name) : undefined),
    reviewedDocxUrl: r.reviewedDocxUrl || r.originalDocxUrl,
  };
}

function referenceAttachments(r: ContractReview): ReviewAttachment[] {
  if (r.attachments && r.attachments.length > 1) {
    return r.attachments.slice(1);
  }
  const names = (r.fileNames || []).slice(1);
  return names.map((name, i) => ({
    id: `ref_${i}`,
    fileName: name,
    originalDocxUrl: sampleUrl(name),
  }));
}

function FileDownloadLinks({
  files,
  empty = "—",
}: {
  files: { name: string; url?: string }[];
  empty?: string;
}) {
  if (!files.length) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return (
    <ul className="space-y-1 max-w-[240px]">
      {files.map((f, i) => {
        const href = f.url || sampleUrl(f.name);
        return (
          <li key={`${f.name}-${i}`}>
            <a
              href={href}
              download={f.name}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-sky-700 hover:underline"
              title={`Tải / xem ${f.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{f.name}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

type SortKey =
  | "documentId"
  | "documentNumber"
  | "documentName"
  | "category"
  | "contractType"
  | "contractName"
  | "businessEntity"
  | "contractBase"
  | "signingDate"
  | "hasDiscount"
  | "discountDetails"
  | "contractValue"
  | "reviewFile"
  | "referenceFiles"
  | "owner"
  | "status"
  | "confidence"
  | "createdAt"
  | "updatedAt";

type SortDir = "asc" | "desc";

function parseMoney(value?: string): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function sortValue(r: ContractReview, key: SortKey): string | number {
  const intake = r.intake;
  switch (key) {
    case "documentId":
      return parseInt(r.documentId || "0", 10) || 0;
    case "documentNumber":
      return (intake?.documentNumber || r.code || "").toLowerCase();
    case "documentName":
      return (intake?.documentName || r.title || "").toLowerCase();
    case "category":
      return (intake?.documentCategoryLabel || "").toLowerCase();
    case "contractType":
      return (r.contractTypeLabel || "").toLowerCase();
    case "contractName":
      return (intake?.contractNameLabel || "").toLowerCase();
    case "businessEntity":
      return (intake?.businessEntityLabel || "").toLowerCase();
    case "contractBase":
      return (intake?.contractBaseLabel || "").toLowerCase();
    case "signingDate":
      return intake?.signingDate || "";
    case "hasDiscount":
      return discountLabel(r).toLowerCase();
    case "discountDetails":
      return (intake?.hasDiscount === "yes" ? intake.discountDetails : "").toLowerCase();
    case "contractValue":
      return parseMoney(intake?.contractValue);
    case "reviewFile":
      return (r.fileName || r.fileNames?.[0] || "").toLowerCase();
    case "referenceFiles":
      return (r.fileNames || []).slice(1).join(", ").toLowerCase();
    case "owner":
      return (r.ownerName || "").toLowerCase();
    case "status":
      return (STATUS_LABEL[r.status] || r.status || "").toLowerCase();
    case "confidence":
      return r.confidence || 0;
    case "createdAt":
      return r.createdAt || "";
    case "updatedAt":
      return r.updatedAt || "";
    default:
      return "";
  }
}

function compareSortValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "vi", { numeric: true });
}

const thClass =
  "sticky top-0 z-10 bg-slate-50 px-3 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap border-b select-none";
const tdClass = "px-3 py-3 align-middle whitespace-nowrap border-b text-sm";

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
  className,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  dir: SortDir;
  onToggle: (key: SortKey) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = activeKey === sortKey;
  return (
    <th
      className={cn(
        thClass,
        "cursor-pointer hover:bg-slate-100 hover:text-foreground",
        active && "text-sky-700",
        className
      )}
      onDoubleClick={() => onToggle(sortKey)}
      title="Double-click để sắp xếp tăng/giảm"
    >
      <span
        className={cn(
          "inline-flex items-center gap-1",
          align === "right" && "flex-row-reverse w-full justify-start"
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : null}
      </span>
    </th>
  );
}

export default function DashboardPage() {
  const [reviews, setReviews] = useState<ContractReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [popupOpen, setPopupOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>("documentId");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [canAdd, setCanAdd] = useState(false);
  const [canConfig, setCanConfig] = useState(false);
  const [canSetup, setCanSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const session = getSession();
    setCanAdd(!!session && canCreateContracts(session));
    setCanConfig(canAccessConfig(session));
    setCanSetup(canAccessConfigurations(session));
    listReviews()
      .then(setReviews)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!popupOpen && !settingsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popupOpen && filterRef.current && !filterRef.current.contains(target)) {
        setPopupOpen(false);
      }
      if (
        settingsOpen &&
        settingsRef.current &&
        !settingsRef.current.contains(target)
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [popupOpen, settingsOpen]);

  const filterOptions = useMemo(
    () => ({
      status: REVIEW_STATUSES.map((s) => ({
        value: s,
        label: STATUS_LABEL[s],
      })),
      category: uniqueSorted(
        reviews.map((r) => r.intake?.documentCategoryLabel)
      ).map((v) => ({ value: v, label: v })),
      contractType: uniqueSorted(reviews.map((r) => r.contractTypeLabel)).map(
        (v) => ({ value: v, label: v })
      ),
      contractName: uniqueSorted(
        reviews.map((r) => r.intake?.contractNameLabel)
      ).map((v) => ({ value: v, label: v })),
      businessEntity: uniqueSorted(
        reviews.map((r) => r.intake?.businessEntityLabel)
      ).map((v) => ({ value: v, label: v })),
      contractBase: uniqueSorted(
        reviews.map((r) => r.intake?.contractBaseLabel)
      ).map((v) => ({ value: v, label: v })),
    }),
    [reviews]
  );

  const usedFields = new Set(activeFilters.map((f) => f.field));
  const availableFields = FILTER_FIELDS.filter((f) => !usedFields.has(f.key));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = reviews.filter((r) => {
      for (const f of activeFilters) {
        if (!f.value) continue;
        if (f.field === "status" && r.status !== f.value) return false;
        if (
          f.field === "category" &&
          (r.intake?.documentCategoryLabel || "") !== f.value
        ) {
          return false;
        }
        if (f.field === "contractType" && r.contractTypeLabel !== f.value) {
          return false;
        }
        if (
          f.field === "contractName" &&
          (r.intake?.contractNameLabel || "") !== f.value
        ) {
          return false;
        }
        if (
          f.field === "businessEntity" &&
          (r.intake?.businessEntityLabel || "") !== f.value
        ) {
          return false;
        }
        if (
          f.field === "contractBase" &&
          (r.intake?.contractBaseLabel || "") !== f.value
        ) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        r.documentId,
        r.code,
        r.title,
        r.ownerName,
        r.fileName,
        r.intake?.documentNumber,
        r.intake?.documentName,
        r.intake?.documentCategoryLabel,
        r.contractTypeLabel,
        r.intake?.contractNameLabel,
        r.intake?.businessEntityLabel,
        r.intake?.contractBaseLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    if (!sortKey) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort(
      (a, b) =>
        compareSortValues(sortValue(a, sortKey), sortValue(b, sortKey)) * dir
    );
  }, [reviews, query, activeFilters, sortKey, sortDir]);

  const hasActiveFilter = query.trim() !== "" || activeFilters.length > 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const addFilterField = (field: FilterFieldKey) => {
    setActiveFilters((prev) => [
      ...prev,
      { id: `${field}_${Date.now()}`, field, value: "" },
    ]);
    setPopupOpen(false);
  };

  const updateFilterValue = (id: string, value: string) => {
    setActiveFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, value } : f))
    );
  };

  const removeFilter = (id: string) => {
    setActiveFilters((prev) => prev.filter((f) => f.id !== id));
  };

  const clearFilters = () => {
    setQuery("");
    setActiveFilters([]);
    setPopupOpen(false);
  };

  return (
    <AppLayout lockViewport mainClassName="!p-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b bg-background px-3 py-2.5 lg:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <h1 className="text-xl font-semibold tracking-tight mr-1">
                Danh sách hợp đồng
              </h1>
              {canAdd && (
                <Button size="sm" asChild>
                  <Link href="/dashboard/contracts/new">
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Link>
                </Button>
              )}
            </div>

            <div className="flex w-full items-center gap-2 sm:max-w-xl lg:max-w-2xl sm:flex-1">
            <div ref={filterRef} className="relative min-w-0 flex-1">
            <div
              className={cn(
                "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-1 shadow-sm transition-colors",
                popupOpen && "border-sky-400 ring-2 ring-sky-100"
              )}
              onClick={() => setPopupOpen(true)}
            >
              <Search className="h-4 w-4 shrink-0 text-muted-foreground ml-1" />

              {activeFilters.map((f) => {
                const options = filterOptions[f.field];
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-1 rounded-md border bg-slate-50 pl-2 pr-1 py-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                      {fieldLabel(f.field)}
                    </span>
                    <Select
                      value={f.value || undefined}
                      onValueChange={(v) => updateFilterValue(f.id, v)}
                    >
                      <SelectTrigger className="h-7 w-auto min-w-[120px] border-0 bg-transparent px-1.5 shadow-none focus:ring-0">
                        <SelectValue placeholder="Chọn…" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => removeFilter(f.id)}
                      aria-label={`Xóa lọc ${fieldLabel(f.field)}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setPopupOpen(true)}
                placeholder={
                  activeFilters.length
                    ? "Thêm từ khóa…"
                    : "Tìm kiếm hoặc thêm bộ lọc…"
                }
                className="h-8 min-w-[140px] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />

              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform mr-1",
                  popupOpen && "rotate-180"
                )}
              />
            </div>

            {popupOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border bg-white shadow-lg">
                <div className="border-b px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Thêm field cần lọc
                  </p>
                </div>
                {availableFields.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Đã thêm tất cả field lọc.
                  </p>
                ) : (
                  <ul className="py-1 max-h-64 overflow-y-auto">
                    {availableFields.map((f) => (
                      <li key={f.key}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 text-left"
                          onClick={() => addFilterField(f.key)}
                        >
                          <Plus className="h-3.5 w-3.5 text-sky-600" />
                          {f.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {hasActiveFilter && (
                  <div className="border-t px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {filtered.length}/{reviews.length} tài liệu
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={clearFilters}
                    >
                      Xóa lọc
                    </Button>
                  </div>
                )}
              </div>
            )}

            </div>

            {(canConfig || canSetup) && (
              <div ref={settingsRef} className="relative shrink-0">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 rounded-lg"
                  aria-label="Cài đặt"
                  aria-expanded={settingsOpen}
                  onClick={() => setSettingsOpen((o) => !o)}
                >
                  <Settings className="h-4 w-4" />
                </Button>
                {settingsOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1.5 min-w-[220px] rounded-lg border bg-white py-1 shadow-lg">
                    {canConfig && (
                      <Link
                        href="/dashboard/config"
                        className="flex w-full items-center px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => setSettingsOpen(false)}
                      >
                        Cấu hình hợp đồng
                      </Link>
                    )}
                    {canSetup && (
                      <Link
                        href="/dashboard/configurations"
                        className="flex w-full items-center px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => setSettingsOpen(false)}
                      >
                        Thiết lập
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background pr-3 pb-3 lg:pr-4 lg:pb-4 pl-0">
            {loading ? (
              <div className="flex flex-1 items-center gap-2 text-muted-foreground py-16 justify-center rounded-none border bg-card">
                <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
              </div>
            ) : reviews.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-none border bg-card py-16">
                <p className="text-sm text-muted-foreground">
                  Chưa có hợp đồng. Hãy tạo tài liệu mới.
                </p>
                {canAdd && (
                  <Button size="sm" asChild>
                    <Link href="/dashboard/contracts/new">
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Link>
                  </Button>
                )}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-none border bg-card py-16">
                <p className="text-sm text-muted-foreground">
                  Không có tài liệu khớp bộ lọc.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Xóa lọc
                </Button>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto rounded-none border bg-card">
                <table className="w-full min-w-[2000px] border-collapse">
                  <thead>
                    <tr>
                      {(
                        [
                          { key: "documentId", label: "ID" },
                          {
                            key: "documentNumber",
                            label: "Số tài liệu (Document number)",
                          },
                          {
                            key: "documentName",
                            label: "Tên tài liệu (Document name)",
                          },
                          {
                            key: "category",
                            label: "Loại hợp đồng (Contract category)",
                          },
                          {
                            key: "contractType",
                            label: "Loại giá trị hợp đồng (Contract value type)",
                          },
                          {
                            key: "contractName",
                            label: "Tên hợp đồng (Contract name)",
                          },
                          {
                            key: "businessEntity",
                            label: "Công ty (Business Entity)",
                          },
                          {
                            key: "contractBase",
                            label: "Hợp đồng tiêu chuẩn (Standard contract)",
                          },
                          {
                            key: "signingDate",
                            label: "Ngày ký (Signing date)",
                          },
                          {
                            key: "hasDiscount",
                            label: "Có chiết khấu (Has discount)",
                          },
                          {
                            key: "discountDetails",
                            label: "Chi tiết chiết khấu (Discount details)",
                          },
                          {
                            key: "contractValue",
                            label: "Giá trị HĐ (Contract value)",
                            align: "right" as const,
                          },
                          {
                            key: "reviewFile",
                            label: "Hợp đồng review (Review file)",
                          },
                          {
                            key: "referenceFiles",
                            label: "Hợp đồng tham khảo (Reference files)",
                          },
                          { key: "owner", label: "Owner" },
                          { key: "status", label: "Trạng thái (Status)" },
                          {
                            key: "confidence",
                            label: "% tin cậy (Confidence)",
                            align: "right" as const,
                          },
                          { key: "createdAt", label: "Tạo lúc (Created)" },
                          { key: "updatedAt", label: "Cập nhật (Updated)" },
                        ] as const
                      ).map((col) => (
                        <SortableTh
                          key={col.key}
                          label={col.label}
                          sortKey={col.key}
                          activeKey={sortKey}
                          dir={sortDir}
                          onToggle={toggleSort}
                          align={"align" in col ? col.align : "left"}
                          className={
                            "align" in col && col.align === "right"
                              ? "text-right"
                              : undefined
                          }
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const intake = r.intake;
                      const reviewAtt = reviewAttachment(r);
                      const refAtts = referenceAttachments(r);
                      return (
                        <tr key={r.id} className="hover:bg-muted/40">
                          <td className={cn(tdClass, "font-mono tabular-nums")}>
                            {cell(r.documentId)}
                          </td>
                          <td className={tdClass}>
                            <Link
                              href={`/dashboard/contracts/${r.id}`}
                              className="text-sky-700 font-medium hover:underline"
                            >
                              {cell(intake?.documentNumber || r.code)}
                            </Link>
                          </td>
                          <td className={cn(tdClass, "max-w-[220px] whitespace-normal")}>
                            <Link
                              href={`/dashboard/contracts/${r.id}`}
                              className="hover:underline font-medium"
                            >
                              {cell(intake?.documentName || r.title)}
                            </Link>
                          </td>
                          <td className={tdClass}>
                            {cell(intake?.documentCategoryLabel)}
                          </td>
                          <td className={cn(tdClass, "max-w-[200px] whitespace-normal")}>
                            {cell(r.contractTypeLabel)}
                          </td>
                          <td className={cn(tdClass, "max-w-[180px] truncate")}>
                            {cell(intake?.contractNameLabel)}
                          </td>
                          <td className={cn(tdClass, "max-w-[180px] truncate")}>
                            {cell(intake?.businessEntityLabel)}
                          </td>
                          <td className={cn(tdClass, "max-w-[160px] truncate")}>
                            {cell(intake?.contractBaseLabel)}
                          </td>
                          <td className={tdClass}>{formatDate(intake?.signingDate)}</td>
                          <td className={tdClass}>{discountLabel(r)}</td>
                          <td className={cn(tdClass, "max-w-[180px] truncate")}>
                            {intake?.hasDiscount === "yes"
                              ? cell(intake.discountDetails)
                              : "—"}
                          </td>
                          <td className={cn(tdClass, "text-right font-medium tabular-nums")}>
                            {cell(intake?.contractValue)}
                          </td>
                          <td className={cn(tdClass, "whitespace-normal")}>
                            <FileDownloadLinks
                              files={
                                reviewAtt
                                  ? [
                                      {
                                        name: reviewAtt.fileName,
                                        url:
                                          reviewAtt.reviewedDocxUrl ||
                                          reviewAtt.originalDocxUrl,
                                      },
                                    ]
                                  : []
                              }
                            />
                          </td>
                          <td className={cn(tdClass, "whitespace-normal")}>
                            <FileDownloadLinks
                              files={refAtts.map((a) => ({
                                name: a.fileName,
                                url: a.originalDocxUrl || a.reviewedDocxUrl,
                              }))}
                            />
                          </td>
                          <td className={cn(tdClass, "max-w-[160px] truncate")}>
                            {cell(r.ownerName)}
                          </td>
                          <td className={tdClass}>
                            <StatusBadge status={r.status} />
                          </td>
                          <td className={cn(tdClass, "text-right tabular-nums")}>
                            {r.confidence ? `${r.confidence}%` : "—"}
                          </td>
                          <td className={cn(tdClass, "text-muted-foreground")}>
                            {formatDateTime(r.createdAt)}
                          </td>
                          <td className={cn(tdClass, "text-muted-foreground")}>
                            {formatDateTime(r.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </AppLayout>
  );
}
