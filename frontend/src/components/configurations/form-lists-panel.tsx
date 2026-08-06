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
  defaultFormLists,
  loadFormLists,
  saveFormLists,
  slugId,
  type FormListsState,
} from "@/lib/form-lists-store";
import {
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
  field,
  description,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  field: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
        aria-expanded={open}
        aria-controls={`form-list-${id}`}
      >
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Field form:{" "}
            <span className="font-medium text-foreground">{field}</span>
            {" · "}
            {description}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
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
  /** Giá trị cột select phụ (vd. Loại hợp đồng). */
  selectValue?: string;
};

function ValueTable({
  rows,
  onChangeCode,
  onChangeValue,
  onChangeSelect,
  onRemove,
  canRemove = true,
  emptyText = "Chưa có dòng — bấm Thêm.",
  selectColumn,
}: {
  rows: TableRow[];
  onChangeCode: (index: number, code: string) => void;
  onChangeValue: (index: number, value: string) => void;
  onChangeSelect?: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  canRemove?: boolean | ((index: number) => boolean);
  emptyText?: string;
  selectColumn?: {
    header: string;
    options: { value: string; label: string }[];
    placeholder?: string;
  };
}) {
  // Key React ổn định — KHÔNG dùng row.key (có thể = Mã/id đang sửa → mất focus mỗi ký tự).
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

  const colSpan = selectColumn ? 5 : 4;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table
        className={cn(
          "w-full border-collapse text-sm",
          selectColumn ? "min-w-[560px]" : "min-w-[420px]"
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
            <th className="w-14 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground border-b">
              Xóa (Delete)
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
              const removable =
                typeof canRemove === "function" ? canRemove(index) : canRemove;
              return (
                <tr
                  key={keysRef.current[index] ?? `fallback_${index}`}
                  className="hover:bg-slate-50/80"
                >
                  <td className="border-b px-3 py-2 text-muted-foreground tabular-nums align-middle">
                    {index + 1}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    <Input
                      value={row.code}
                      className="h-9 font-mono text-xs"
                      disabled={row.codeReadOnly}
                      onChange={(e) => onChangeCode(index, e.target.value)}
                      aria-label={`Mã dòng ${index + 1}`}
                    />
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    <Input
                      value={row.value}
                      className="h-9"
                      onChange={(e) => onChangeValue(index, e.target.value)}
                      aria-label={`Giá trị dòng ${index + 1}`}
                    />
                  </td>
                  {selectColumn && (
                    <td className="border-b px-3 py-2 align-middle">
                      <Select
                        value={row.selectValue || undefined}
                        onValueChange={(v) => onChangeSelect?.(index, v)}
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

export function FormListsPanel() {
  const { toast } = useToast();
  const [state, setState] = useState<FormListsState | null>(null);
  const [openSections, setOpenSections] = useState<
    Partial<Record<SectionId, boolean>>
  >({});

  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    setState(loadFormLists());
  }, []);

  if (!state) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Đang tải cấu hình list…
      </p>
    );
  }

  const persist = (next: FormListsState, msg = "Đã lưu cấu hình list") => {
    setState(next);
    saveFormLists(next);
    toast({ title: msg });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Các dropdown trên màn <strong>Tạo tài liệu</strong> lấy dữ liệu từ đây.
          Mỗi list: cột <strong>Mã (Code)</strong> + <strong>Giá trị (Value)</strong>.
          Nhãn hiển thị song ngữ Việt — Anh. Bấm tiêu đề để thu gọn / mở rộng.
        </p>
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
      >
        <ValueTable
          rows={state.documentCategories.map((c) => ({
            key: c.id,
            code: c.code,
            value: c.label,
          }))}
          canRemove={() => state.documentCategories.length > 1}
          onChangeCode={(index, code) => {
            const documentCategories = [...state.documentCategories];
            documentCategories[index] = {
              ...documentCategories[index],
              code,
            };
            setState({ ...state, documentCategories });
          }}
          onChangeValue={(index, value) => {
            const documentCategories = [...state.documentCategories];
            documentCategories[index] = {
              ...documentCategories[index],
              label: value,
            };
            setState({ ...state, documentCategories });
          }}
          onRemove={(index) => {
            setState({
              ...state,
              documentCategories: state.documentCategories.filter(
                (_, i) => i !== index
              ),
            });
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
                  { id: slugId("cat", label), label, code: `NEW${n}` },
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
      </Section>

      <Section
        id="contractTypes"
        title="Loại giá trị hợp đồng (Contract value type)"
        field="Loại giá trị hợp đồng (Contract value type)"
        description="Nguồn dropdown cùng tên trên form Tạo tài liệu. Checklist / Matrix chi tiết ở Cấu hình loại HĐ."
        open={!!openSections.contractTypes}
        onToggle={() => toggleSection("contractTypes")}
      >
        <ValueTable
          rows={state.contractTypes.map((t) => ({
            key: t.id,
            code: t.id,
            value: t.label,
          }))}
          canRemove={() => state.contractTypes.length > 1}
          onChangeCode={(index, code) => {
            const contractTypes = [...state.contractTypes];
            contractTypes[index] = {
              ...contractTypes[index],
              // Không trim khi gõ — trim lúc Lưu (tránh nhảy con trỏ / mất ký tự).
              id: code,
            };
            setState({ ...state, contractTypes });
          }}
          onChangeValue={(index, value) => {
            const contractTypes = [...state.contractTypes];
            contractTypes[index] = {
              ...contractTypes[index],
              label: value,
            };
            setState({ ...state, contractTypes });
          }}
          onRemove={(index) => {
            setState({
              ...state,
              contractTypes: state.contractTypes.filter((_, i) => i !== index),
            });
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
                  .map((t) => ({ ...t, id: t.id.trim(), label: t.label.trim() }))
                  .filter((t) => t.label && t.id),
              })
            }
          >
            <Save className="mr-2 h-4 w-4" />
            Lưu
          </Button>
        </div>
      </Section>

      <Section
        id="contractNames"
        title="Tên hợp đồng (Contract name)"
        field="Tên hợp đồng (Contract name)"
        description="Dropdown bắt buộc trên form tạo review — lọc theo Loại hợp đồng / Contract category (HQP, RAW, MRO, CAPEX, LOG)."
        open={!!openSections.contractNames}
        onToggle={() => toggleSection("contractNames")}
      >
        <ValueTable
          rows={state.contractNames.map((n) => ({
            key: n.id,
            code: n.code,
            value: n.label,
            selectValue: n.documentCategoryId,
          }))}
          selectColumn={{
            header: "Loại hợp đồng (Contract category)",
            placeholder: "Chọn loại (vd. CAPEX)",
            options: state.documentCategories.map((c) => ({
              value: c.id,
              label: c.label,
            })),
          }}
          canRemove={() => state.contractNames.length > 1}
          onChangeCode={(index, code) => {
            const contractNames = [...state.contractNames];
            contractNames[index] = { ...contractNames[index], code };
            setState({ ...state, contractNames });
          }}
          onChangeValue={(index, value) => {
            const contractNames = [...state.contractNames];
            contractNames[index] = { ...contractNames[index], label: value };
            setState({ ...state, contractNames });
          }}
          onChangeSelect={(index, documentCategoryId) => {
            const contractNames = [...state.contractNames];
            contractNames[index] = {
              ...contractNames[index],
              documentCategoryId,
            };
            setState({ ...state, contractNames });
          }}
          onRemove={(index) => {
            setState({
              ...state,
              contractNames: state.contractNames.filter((_, i) => i !== index),
            });
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
                state.documentCategories[0]?.id ||
                state.contractNames[0]?.documentCategoryId ||
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
      </Section>

      <Section
        id="businessEntities"
        title="Công ty (Business Entity)"
        field="Công ty (Business Entity)"
        description="Dropdown bắt buộc trên form tạo review."
        open={!!openSections.businessEntities}
        onToggle={() => toggleSection("businessEntities")}
      >
        <ValueTable
          rows={state.businessEntities.map((e) => ({
            key: e.id,
            code: e.code,
            value: e.label,
          }))}
          canRemove={() => state.businessEntities.length > 1}
          onChangeCode={(index, code) => {
            const businessEntities = [...state.businessEntities];
            businessEntities[index] = { ...businessEntities[index], code };
            setState({ ...state, businessEntities });
          }}
          onChangeValue={(index, value) => {
            const businessEntities = [...state.businessEntities];
            businessEntities[index] = {
              ...businessEntities[index],
              label: value,
            };
            setState({ ...state, businessEntities });
          }}
          onRemove={(index) => {
            setState({
              ...state,
              businessEntities: state.businessEntities.filter(
                (_, i) => i !== index
              ),
            });
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
      </Section>

      <Section
        id="contractBases"
        title="Hợp đồng tiêu chuẩn (Standard contract)"
        field="Hợp đồng tiêu chuẩn (Standard contract)"
        description="Dropdown bắt buộc trên form tạo review."
        open={!!openSections.contractBases}
        onToggle={() => toggleSection("contractBases")}
      >
        <ValueTable
          rows={state.contractBases.map((b) => ({
            key: b.id,
            code: b.code,
            value: b.label,
          }))}
          canRemove={() => state.contractBases.length > 1}
          onChangeCode={(index, code) => {
            const contractBases = [...state.contractBases];
            contractBases[index] = { ...contractBases[index], code };
            setState({ ...state, contractBases });
          }}
          onChangeValue={(index, value) => {
            const contractBases = [...state.contractBases];
            contractBases[index] = { ...contractBases[index], label: value };
            setState({ ...state, contractBases });
          }}
          onRemove={(index) => {
            setState({
              ...state,
              contractBases: state.contractBases.filter((_, i) => i !== index),
            });
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
      </Section>

      <Section
        id="discountOptions"
        title="Hợp đồng có chiết khấu (Has discount)"
        field="Hợp đồng có chiết khấu (Has discount)"
        description="Mã nội bộ (yes/no) cố định — chỉnh nhãn hiển thị ở Giá trị (Value)."
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
