"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  countFormListItemUsage,
  isFormListItemArchived,
  slugId,
  type FormListKind,
  type FormListsState,
} from "@/lib/form-lists-store";
import {
  defaultFormLists,
  fetchFormLists,
  persistFormLists,
} from "@/lib/form-lists-service";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function Section({
  id,
  title,
  open,
  onToggle,
  children,
  archiveCount = 0,
  showArchived = false,
  onToggleArchived,
}: {
  id: string;
  title: string;
  /** @deprecated giữ prop để call site cũ không vỡ — không hiển thị. */
  field?: string;
  /** @deprecated giữ prop để call site cũ không vỡ — không hiển thị. */
  description?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Số item đã lưu trữ trong list này — hiện nút bên phải header. */
  archiveCount?: number;
  showArchived?: boolean;
  onToggleArchived?: () => void;
}) {
  return (
    <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          aria-expanded={open}
          aria-controls={`form-list-${id}`}
        >
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
        {onToggleArchived && (
          <Button
            type="button"
            size="sm"
            variant={showArchived ? "secondary" : "outline"}
            className="shrink-0"
            onClick={onToggleArchived}
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            {showArchived
              ? "Ẩn đã lưu trữ"
              : archiveCount > 0
                ? `Đã lưu trữ (${archiveCount})`
                : "Đã lưu trữ"}
          </Button>
        )}
      </div>
      {open && (
        <div
          id={`form-list-${id}`}
          className="space-y-3 border-t px-5 py-4"
        >
          {children}
        </div>
      )}
    </section>
  );
}

type TableRow = {
  key: string;
  code: string;
  value: string;
  codeReadOnly?: boolean;
  selectValue?: string;
  archived?: boolean;
  usage?: number;
};

function ValueTable({
  rows,
  onChangeCode,
  onChangeValue,
  onChangeSelect,
  onRemove,
  onArchive,
  onRestore,
  canRemove = true,
  enableArchive = true,
  emptyText = "Chưa có dòng — bấm Thêm.",
  selectColumn,
}: {
  rows: TableRow[];
  onChangeCode: (index: number, code: string) => void;
  onChangeValue: (index: number, value: string) => void;
  onChangeSelect?: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  onArchive?: (index: number) => void;
  onRestore?: (index: number) => void;
  canRemove?: boolean | ((index: number) => boolean);
  enableArchive?: boolean;
  emptyText?: string;
  selectColumn?: {
    header: string;
    options: { value: string; label: string }[];
    placeholder?: string;
  };
}) {
  const keysRef = useRef<string[]>([]);
  while (keysRef.current.length < rows.length) {
    keysRef.current.push(`fl_row_${Math.random().toString(36).slice(2, 9)}`);
  }
  if (keysRef.current.length > rows.length) {
    keysRef.current.length = rows.length;
  }

  const handleRemove = (index: number) => {
    keysRef.current.splice(index, 1);
    onRemove(index);
  };

  const colSpan = 4 + (selectColumn ? 1 : 0) + (enableArchive ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table
        className={cn(
          "w-full border-collapse text-sm",
          enableArchive ? "min-w-[720px]" : selectColumn ? "min-w-[560px]" : "min-w-[420px]"
        )}
      >
        <thead>
          <tr>
            <th className="w-10 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
              #
            </th>
            <th className="w-40 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
              Mã (Code)
            </th>
            <th className="bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
              Giá trị (Value)
            </th>
            {selectColumn && (
              <th className="w-56 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
                {selectColumn.header}
              </th>
            )}
            {enableArchive && (
              <th className="w-36 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
                Lưu trữ
              </th>
            )}
            <th className="w-14 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground border-b">
              Xóa
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={colSpan}
                className="border-b px-3 py-6 text-center text-sm text-muted-foreground"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const usage = row.usage ?? 0;
              const removableBase =
                typeof canRemove === "function" ? canRemove(index) : canRemove;
              // Chỉ xóa khi chưa có transaction
              const removable = removableBase && usage === 0 && !row.archived;
              return (
                <tr
                  key={keysRef.current[index] ?? `fallback_${index}`}
                  className={cn(
                    "hover:bg-slate-50/80",
                    row.archived && "bg-muted/40 text-muted-foreground"
                  )}
                >
                  <td className="border-b px-3 py-2 text-muted-foreground tabular-nums align-middle">
                    {index + 1}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    <Input
                      value={row.code}
                      className="h-9 font-mono text-xs"
                      disabled={row.codeReadOnly || row.archived}
                      onChange={(e) => onChangeCode(index, e.target.value)}
                      aria-label={`Mã dòng ${index + 1}`}
                    />
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    <Input
                      value={row.value}
                      className="h-9"
                      disabled={row.archived}
                      onChange={(e) => onChangeValue(index, e.target.value)}
                      aria-label={`Giá trị dòng ${index + 1}`}
                    />
                  </td>
                  {selectColumn && (
                    <td className="border-b px-3 py-2 align-middle">
                      <Select
                        value={row.selectValue || undefined}
                        onValueChange={(v) => onChangeSelect?.(index, v)}
                        disabled={row.archived}
                      >
                        <SelectTrigger
                          className="h-9"
                          aria-label={`${selectColumn.header} dòng ${index + 1}`}
                        >
                          <SelectValue
                            placeholder={
                              selectColumn.placeholder || "Chọn…"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {selectColumn.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  )}
                  {enableArchive && (
                    <td className="border-b px-3 py-2 align-middle">
                      <div className="flex flex-wrap items-center gap-1">
                        {row.archived ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => onRestore?.(index)}
                            title="Bỏ lưu trữ — hiện lại trên form tạo HĐ"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
                            Bỏ lưu trữ
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => onArchive?.(index)}
                            title={
                              usage > 0
                                ? `Đã dùng bởi ${usage} HĐ — chỉ lưu trữ, không xóa`
                                : "Lưu trữ — ẩn khỏi form tạo HĐ"
                            }
                          >
                            <Archive className="h-3.5 w-3.5 mr-1" />
                            Lưu trữ
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                  <td className="border-b px-3 py-2 text-center align-middle">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-8 w-8 text-muted-foreground hover:text-destructive",
                        !removable && "opacity-40"
                      )}
                      disabled={!removable}
                      title={
                        row.archived
                          ? "Khôi phục trước nếu muốn xóa, hoặc giữ lưu trữ"
                          : usage > 0
                            ? enableArchive
                              ? `Không xóa — đang dùng bởi ${usage} HĐ. Dùng Lưu trữ.`
                              : `Không xóa — đang dùng bởi ${usage} HĐ.`
                            : !removableBase
                              ? "Không thể xóa dòng cuối / dòng cố định"
                              : "Xóa giá trị (chưa có giao dịch)"
                      }
                      onClick={() => handleRemove(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

type SectionId =
  | "documentCategories"
  | "contractTypes"
  | "contractNames"
  | "businessEntities"
  | "contractBases"
  | "discountOptions";

function withUsage(
  kind: FormListKind,
  id: string,
  archived: boolean
): Pick<TableRow, "usage" | "archived"> {
  return {
    usage: countFormListItemUsage(kind, id),
    archived,
  };
}

export function FormListsPanel() {
  const { toast } = useToast();
  const [state, setState] = useState<FormListsState | null>(null);
  const [showArchivedBySection, setShowArchivedBySection] = useState<
    Partial<Record<SectionId, boolean>>
  >({});
  const [openSections, setOpenSections] = useState<
    Partial<Record<SectionId, boolean>>
  >({});

  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleShowArchived = (id: SectionId) => {
    setShowArchivedBySection((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    fetchFormLists()
      .then(setState)
      .catch((e) =>
        toast({
          title: "Không tải được Form lists",
          description: e instanceof Error ? e.message : "Lỗi",
          variant: "destructive",
        })
      );
  }, [toast]);

  if (!state) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Đang tải cấu hình list…
      </p>
    );
  }

  const persist = (next: FormListsState, msg = "Đã lưu cấu hình list") => {
    setState(next);
    void persistFormLists(next)
      .then(() => toast({ title: msg }))
      .catch((e) =>
        toast({
          title: "Không lưu được Form lists",
          description: e instanceof Error ? e.message : "Lỗi",
          variant: "destructive",
        })
      );
  };

  const visible = <T extends { status?: string }>(
    sectionId: SectionId,
    items: T[],
    archivedCheck: (item: T) => boolean = (i) => isFormListItemArchived(i)
  ) =>
    showArchivedBySection[sectionId]
      ? items
      : items.filter((i) => !archivedCheck(i));

  /** Map index trên bảng đã lọc → index thật trong state. */
  const realIndex = <T,>(
    all: T[],
    visibleItems: T[],
    visibleIndex: number
  ) => {
    const item = visibleItems[visibleIndex];
    return all.indexOf(item);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const next = defaultFormLists();
            persist(next, "Đã khôi phục mặc định");
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset mặc định
        </Button>
      </div>

      <Section
        id="documentCategories"
        title="Loại hợp đồng (Contract category)"
        field="Loại hợp đồng (Contract category)"
        description="Dropdown bắt buộc khi tạo review (HQP, RAW, MRO, CAPEX, LOG)."
        open={!!openSections.documentCategories}
        onToggle={() => toggleSection("documentCategories")}
        archiveCount={
          state.documentCategories.filter((c) => isFormListItemArchived(c))
            .length
        }
        showArchived={!!showArchivedBySection.documentCategories}
        onToggleArchived={() => toggleShowArchived("documentCategories")}
      >
        {(() => {
          const all = state.documentCategories;
          const rows = visible("documentCategories", all);
          return (
            <>
              <ValueTable
                rows={rows.map((c) => ({
                  key: c.id,
                  code: c.code,
                  value: c.label,
                  ...withUsage(
                    "documentCategories",
                    c.id,
                    isFormListItemArchived(c)
                  ),
                }))}
                canRemove={() =>
                  all.filter((c) => !isFormListItemArchived(c)).length > 1
                }
                onChangeCode={(vi, code) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const documentCategories = [...all];
                  documentCategories[index] = {
                    ...documentCategories[index],
                    code,
                  };
                  setState({ ...state, documentCategories });
                }}
                onChangeValue={(vi, value) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const documentCategories = [...all];
                  documentCategories[index] = {
                    ...documentCategories[index],
                    label: value,
                  };
                  setState({ ...state, documentCategories });
                }}
                onArchive={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const usage = countFormListItemUsage(
                    "documentCategories",
                    item.id
                  );
                  const documentCategories = all.map((c, i) =>
                    i === index ? { ...c, status: "archived" as const } : c
                  );
                  persist(
                    { ...state, documentCategories },
                    usage > 0
                      ? `Đã lưu trữ «${item.label}» (${usage} HĐ vẫn giữ tham chiếu)`
                      : `Đã lưu trữ «${item.label}»`
                  );
                }}
                onRestore={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const documentCategories = all.map((c, i) =>
                    i === index ? { ...c, status: "active" as const } : c
                  );
                  persist(
                    { ...state, documentCategories },
                    `Đã bỏ lưu trữ «${item.label}»`
                  );
                }}
                onRemove={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  if (countFormListItemUsage("documentCategories", item.id) > 0) {
                    toast({
                      title: "Không xóa được",
                      description:
                        "Giá trị đã có giao dịch — chỉ được Lưu trữ.",
                      variant: "destructive",
                    });
                    return;
                  }
                  persist(
                    {
                      ...state,
                      documentCategories: all.filter((_, i) => i !== index),
                    },
                    `Đã xóa «${item.label}»`
                  );
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const n = state.documentCategories.length + 1;
                    const label = `Loại hợp đồng (Contract category) mới ${n}`;
                    setState({
                      ...state,
                      documentCategories: [
                        ...state.documentCategories,
                        {
                          id: slugId("cat", label),
                          label,
                          code: `NEW${n}`,
                          status: "active",
                        },
                      ],
                    });
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Thêm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    persist({
                      ...state,
                      documentCategories: state.documentCategories.filter(
                        (c) => c.label.trim() && c.code.trim()
                      ),
                    })
                  }
                >
                  <Save className="mr-2 h-4 w-4" />
                  Lưu
                </Button>
              </div>
            </>
          );
        })()}
      </Section>

      <Section
        id="contractTypes"
        title="Loại giá trị hợp đồng (Contract value type)"
        field="Loại giá trị hợp đồng (Contract value type)"
        description="Nguồn dropdown cùng tên trên form Tạo tài liệu. Checklist / Matrix chi tiết ở Cấu hình loại HĐ."
        open={!!openSections.contractTypes}
        onToggle={() => toggleSection("contractTypes")}
        archiveCount={
          state.contractTypes.filter((t) => t.status === "archived").length
        }
        showArchived={!!showArchivedBySection.contractTypes}
        onToggleArchived={() => toggleShowArchived("contractTypes")}
      >
        {(() => {
          const all = state.contractTypes;
          const rows = visible(
            "contractTypes",
            all,
            (t) => t.status === "archived"
          );
          return (
            <>
              <ValueTable
                rows={rows.map((t) => ({
                  key: t.id,
                  code: t.id,
                  value: t.label,
                  ...withUsage(
                    "contractTypes",
                    t.id,
                    t.status === "archived"
                  ),
                }))}
                canRemove={() =>
                  all.filter((t) => t.status !== "archived").length > 1
                }
                onChangeCode={(vi, code) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const contractTypes = [...all];
                  contractTypes[index] = {
                    ...contractTypes[index],
                    id: code,
                  };
                  setState({ ...state, contractTypes });
                }}
                onChangeValue={(vi, value) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const contractTypes = [...all];
                  contractTypes[index] = {
                    ...contractTypes[index],
                    label: value,
                  };
                  setState({ ...state, contractTypes });
                }}
                onArchive={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const usage = countFormListItemUsage("contractTypes", item.id);
                  const contractTypes = all.map((t, i) =>
                    i === index ? { ...t, status: "archived" as const } : t
                  );
                  persist(
                    { ...state, contractTypes },
                    usage > 0
                      ? `Đã lưu trữ «${item.label}» (${usage} HĐ)`
                      : `Đã lưu trữ «${item.label}»`
                  );
                }}
                onRestore={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const contractTypes = all.map((t, i) =>
                    i === index ? { ...t, status: "published" as const } : t
                  );
                  persist(
                    { ...state, contractTypes },
                    `Đã bỏ lưu trữ «${item.label}»`
                  );
                }}
                onRemove={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  if (countFormListItemUsage("contractTypes", item.id) > 0) {
                    toast({
                      title: "Không xóa được",
                      description: "Giá trị đã có giao dịch — chỉ được Lưu trữ.",
                      variant: "destructive",
                    });
                    return;
                  }
                  persist(
                    {
                      ...state,
                      contractTypes: all.filter((_, i) => i !== index),
                    },
                    `Đã xóa «${item.label}»`
                  );
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const n = state.contractTypes.length + 1;
                    const label = `Loại giá trị HĐ mới ${n}`;
                    setState({
                      ...state,
                      contractTypes: [
                        ...state.contractTypes,
                        {
                          id: slugId("ct", label),
                          label,
                          group: "vendor",
                          requireTemplateMatch: false,
                          hasChecklist: false,
                          status: "published",
                        },
                      ],
                    });
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Thêm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    persist({
                      ...state,
                      contractTypes: state.contractTypes
                        .map((t) => ({
                          ...t,
                          id: t.id.trim(),
                          label: t.label.trim(),
                        }))
                        .filter((t) => t.label && t.id),
                    })
                  }
                >
                  <Save className="mr-2 h-4 w-4" />
                  Lưu
                </Button>
              </div>
            </>
          );
        })()}
      </Section>

      <Section
        id="contractNames"
        title="Tên hợp đồng (Contract name)"
        field="Tên hợp đồng (Contract name)"
        description="Dropdown bắt buộc trên form tạo review — lọc theo Loại hợp đồng / Contract category."
        open={!!openSections.contractNames}
        onToggle={() => toggleSection("contractNames")}
        archiveCount={
          state.contractNames.filter((n) => isFormListItemArchived(n)).length
        }
        showArchived={!!showArchivedBySection.contractNames}
        onToggleArchived={() => toggleShowArchived("contractNames")}
      >
        {(() => {
          const all = state.contractNames;
          const rows = visible("contractNames", all);
          const categoryOptions = (
            showArchivedBySection.contractNames
              ? state.documentCategories
              : state.documentCategories.filter(
                  (c) => !isFormListItemArchived(c)
                )
          ).map((c) => ({
            value: c.id,
            label: isFormListItemArchived(c)
              ? `${c.label} (đã lưu trữ)`
              : c.label,
          }));
          return (
            <>
              <ValueTable
                rows={rows.map((n) => ({
                  key: n.id,
                  code: n.code,
                  value: n.label,
                  selectValue: n.documentCategoryId,
                  ...withUsage(
                    "contractNames",
                    n.id,
                    isFormListItemArchived(n)
                  ),
                }))}
                selectColumn={{
                  header: "Loại hợp đồng (Contract category)",
                  placeholder: "Chọn loại (vd. CAPEX)",
                  options: categoryOptions,
                }}
                canRemove={() =>
                  all.filter((n) => !isFormListItemArchived(n)).length > 1
                }
                onChangeCode={(vi, code) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const contractNames = [...all];
                  contractNames[index] = { ...contractNames[index], code };
                  setState({ ...state, contractNames });
                }}
                onChangeValue={(vi, value) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const contractNames = [...all];
                  contractNames[index] = {
                    ...contractNames[index],
                    label: value,
                  };
                  setState({ ...state, contractNames });
                }}
                onChangeSelect={(vi, documentCategoryId) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const contractNames = [...all];
                  contractNames[index] = {
                    ...contractNames[index],
                    documentCategoryId,
                  };
                  setState({ ...state, contractNames });
                }}
                onArchive={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const usage = countFormListItemUsage("contractNames", item.id);
                  const contractNames = all.map((n, i) =>
                    i === index ? { ...n, status: "archived" as const } : n
                  );
                  persist(
                    { ...state, contractNames },
                    usage > 0
                      ? `Đã lưu trữ «${item.label}» (${usage} HĐ)`
                      : `Đã lưu trữ «${item.label}»`
                  );
                }}
                onRestore={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const contractNames = all.map((n, i) =>
                    i === index ? { ...n, status: "active" as const } : n
                  );
                  persist(
                    { ...state, contractNames },
                    `Đã bỏ lưu trữ «${item.label}»`
                  );
                }}
                onRemove={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  if (countFormListItemUsage("contractNames", item.id) > 0) {
                    toast({
                      title: "Không xóa được",
                      description:
                        "Giá trị đã có giao dịch — chỉ được Lưu trữ.",
                      variant: "destructive",
                    });
                    return;
                  }
                  persist(
                    {
                      ...state,
                      contractNames: all.filter((_, i) => i !== index),
                    },
                    `Đã xóa «${item.label}»`
                  );
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const n = state.contractNames.length + 1;
                    const label = `Tên hợp đồng ${n}`;
                    const defaultCat =
                      state.documentCategories.find(
                        (c) => c.status !== "archived"
                      )?.id ||
                      state.documentCategories[0]?.id ||
                      "";
                    setState({
                      ...state,
                      contractNames: [
                        ...state.contractNames,
                        {
                          id: slugId("cn", label),
                          code: `CN${n}`,
                          label,
                          documentCategoryId: defaultCat,
                          status: "active",
                        },
                      ],
                    });
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Thêm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    persist({
                      ...state,
                      contractNames: state.contractNames.filter(
                        (n) =>
                          n.label.trim() &&
                          n.code.trim() &&
                          n.documentCategoryId.trim()
                      ),
                    })
                  }
                >
                  <Save className="mr-2 h-4 w-4" />
                  Lưu
                </Button>
              </div>
            </>
          );
        })()}
      </Section>

      <Section
        id="businessEntities"
        title="Công ty (Business Entity)"
        field="Công ty (Business Entity)"
        description="Dropdown bắt buộc trên form tạo review."
        open={!!openSections.businessEntities}
        onToggle={() => toggleSection("businessEntities")}
        archiveCount={
          state.businessEntities.filter((e) => isFormListItemArchived(e))
            .length
        }
        showArchived={!!showArchivedBySection.businessEntities}
        onToggleArchived={() => toggleShowArchived("businessEntities")}
      >
        {(() => {
          const all = state.businessEntities;
          const rows = visible("businessEntities", all);
          return (
            <>
              <ValueTable
                rows={rows.map((e) => ({
                  key: e.id,
                  code: e.code,
                  value: e.label,
                  ...withUsage(
                    "businessEntities",
                    e.id,
                    isFormListItemArchived(e)
                  ),
                }))}
                canRemove={() =>
                  all.filter((e) => !isFormListItemArchived(e)).length > 1
                }
                onChangeCode={(vi, code) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const businessEntities = [...all];
                  businessEntities[index] = {
                    ...businessEntities[index],
                    code,
                  };
                  setState({ ...state, businessEntities });
                }}
                onChangeValue={(vi, value) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const businessEntities = [...all];
                  businessEntities[index] = {
                    ...businessEntities[index],
                    label: value,
                  };
                  setState({ ...state, businessEntities });
                }}
                onArchive={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const usage = countFormListItemUsage(
                    "businessEntities",
                    item.id
                  );
                  const businessEntities = all.map((e, i) =>
                    i === index ? { ...e, status: "archived" as const } : e
                  );
                  persist(
                    { ...state, businessEntities },
                    usage > 0
                      ? `Đã lưu trữ «${item.label}» (${usage} HĐ)`
                      : `Đã lưu trữ «${item.label}»`
                  );
                }}
                onRestore={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const businessEntities = all.map((e, i) =>
                    i === index ? { ...e, status: "active" as const } : e
                  );
                  persist(
                    { ...state, businessEntities },
                    `Đã bỏ lưu trữ «${item.label}»`
                  );
                }}
                onRemove={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  if (countFormListItemUsage("businessEntities", item.id) > 0) {
                    toast({
                      title: "Không xóa được",
                      description: "Giá trị đã có giao dịch — chỉ được Lưu trữ.",
                      variant: "destructive",
                    });
                    return;
                  }
                  persist(
                    {
                      ...state,
                      businessEntities: all.filter((_, i) => i !== index),
                    },
                    `Đã xóa «${item.label}»`
                  );
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const n = state.businessEntities.length + 1;
                    const label = `Công ty mới ${n}`;
                    setState({
                      ...state,
                      businessEntities: [
                        ...state.businessEntities,
                        {
                          id: slugId("be", label),
                          code: `BE${n}`,
                          label,
                          status: "active",
                        },
                      ],
                    });
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Thêm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    persist({
                      ...state,
                      businessEntities: state.businessEntities.filter(
                        (e) => e.label.trim() && e.code.trim()
                      ),
                    })
                  }
                >
                  <Save className="mr-2 h-4 w-4" />
                  Lưu
                </Button>
              </div>
            </>
          );
        })()}
      </Section>

      <Section
        id="contractBases"
        title="Hợp đồng tiêu chuẩn (Standard contract)"
        field="Hợp đồng tiêu chuẩn (Standard contract)"
        description="Dropdown bắt buộc trên form tạo review."
        open={!!openSections.contractBases}
        onToggle={() => toggleSection("contractBases")}
        archiveCount={
          state.contractBases.filter((b) => isFormListItemArchived(b)).length
        }
        showArchived={!!showArchivedBySection.contractBases}
        onToggleArchived={() => toggleShowArchived("contractBases")}
      >
        {(() => {
          const all = state.contractBases;
          const rows = visible("contractBases", all);
          return (
            <>
              <ValueTable
                rows={rows.map((b) => ({
                  key: b.id,
                  code: b.code,
                  value: b.label,
                  ...withUsage(
                    "contractBases",
                    b.id,
                    isFormListItemArchived(b)
                  ),
                }))}
                canRemove={() =>
                  all.filter((b) => !isFormListItemArchived(b)).length > 1
                }
                onChangeCode={(vi, code) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const contractBases = [...all];
                  contractBases[index] = { ...contractBases[index], code };
                  setState({ ...state, contractBases });
                }}
                onChangeValue={(vi, value) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const contractBases = [...all];
                  contractBases[index] = {
                    ...contractBases[index],
                    label: value,
                  };
                  setState({ ...state, contractBases });
                }}
                onArchive={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const usage = countFormListItemUsage("contractBases", item.id);
                  const contractBases = all.map((b, i) =>
                    i === index ? { ...b, status: "archived" as const } : b
                  );
                  persist(
                    { ...state, contractBases },
                    usage > 0
                      ? `Đã lưu trữ «${item.label}» (${usage} HĐ)`
                      : `Đã lưu trữ «${item.label}»`
                  );
                }}
                onRestore={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  const contractBases = all.map((b, i) =>
                    i === index ? { ...b, status: "active" as const } : b
                  );
                  persist(
                    { ...state, contractBases },
                    `Đã bỏ lưu trữ «${item.label}»`
                  );
                }}
                onRemove={(vi) => {
                  const index = realIndex(all, rows, vi);
                  if (index < 0) return;
                  const item = all[index];
                  if (countFormListItemUsage("contractBases", item.id) > 0) {
                    toast({
                      title: "Không xóa được",
                      description: "Giá trị đã có giao dịch — chỉ được Lưu trữ.",
                      variant: "destructive",
                    });
                    return;
                  }
                  persist(
                    {
                      ...state,
                      contractBases: all.filter((_, i) => i !== index),
                    },
                    `Đã xóa «${item.label}»`
                  );
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const n = state.contractBases.length + 1;
                    const label = `Hợp đồng tiêu chuẩn mới ${n}`;
                    setState({
                      ...state,
                      contractBases: [
                        ...state.contractBases,
                        {
                          id: slugId("cb", label),
                          code: `CB${n}`,
                          label,
                          status: "active",
                        },
                      ],
                    });
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Thêm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    persist({
                      ...state,
                      contractBases: state.contractBases.filter(
                        (b) => b.label.trim() && b.code.trim()
                      ),
                    })
                  }
                >
                  <Save className="mr-2 h-4 w-4" />
                  Lưu
                </Button>
              </div>
            </>
          );
        })()}
      </Section>

      <Section
        id="discountOptions"
        title="Hợp đồng có chiết khấu (Has discount)"
        field="Hợp đồng có chiết khấu (Has discount)"
        description="Mã nội bộ (yes/no) cố định — chỉnh nhãn hiển thị ở Giá trị (Value). Không xóa / lưu trữ."
        open={!!openSections.discountOptions}
        onToggle={() => toggleSection("discountOptions")}
      >
        <ValueTable
          rows={state.discountOptions.map((d) => ({
            key: d.value,
            code: d.value,
            value: d.label,
            codeReadOnly: true,
          }))}
          canRemove={false}
          enableArchive={false}
          onChangeCode={() => undefined}
          onChangeValue={(index, value) => {
            const discountOptions = [...state.discountOptions];
            discountOptions[index] = {
              ...discountOptions[index],
              label: value,
            };
            setState({ ...state, discountOptions });
          }}
          onRemove={() => undefined}
        />
        <Button
          type="button"
          size="sm"
          onClick={() =>
            persist({
              ...state,
              discountOptions: state.discountOptions.map((d) => ({
                ...d,
                label: d.label.trim() || d.value,
              })),
            })
          }
        >
          <Save className="mr-2 h-4 w-4" />
          Lưu
        </Button>
      </Section>
    </div>
  );
}
