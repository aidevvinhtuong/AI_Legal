"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  defaultFormLists,
  loadFormLists,
  saveFormLists,
  slugId,
  type FormListsState,
} from "@/lib/form-lists-store";
import { ExternalLink, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

function Section({
  title,
  field,
  description,
  children,
}: {
  title: string;
  field: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <header className="border-b px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Field form: <span className="font-medium text-foreground">{field}</span>
          {" · "}
          {description}
        </p>
      </header>
      <div className="space-y-3 px-5 py-4">{children}</div>
    </section>
  );
}

type TableRow = {
  key: string;
  code: string;
  value: string;
  codeReadOnly?: boolean;
};

function ValueTable({
  rows,
  onChangeCode,
  onChangeValue,
  onRemove,
  canRemove = true,
  emptyText = "Chưa có dòng — bấm Thêm.",
}: {
  rows: TableRow[];
  onChangeCode: (index: number, code: string) => void;
  onChangeValue: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  canRemove?: boolean | ((index: number) => boolean);
  emptyText?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-10 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
              #
            </th>
            <th className="w-40 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
              Mã
            </th>
            <th className="bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b">
              Giá trị
            </th>
            <th className="w-14 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground border-b">
              Xóa
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={4}
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
                <tr key={row.key} className="hover:bg-slate-50/80">
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
                      onClick={() => onRemove(index)}
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

export function FormListsPanel() {
  const { toast } = useToast();
  const [state, setState] = useState<FormListsState | null>(null);

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
          Mỗi list: cột <strong>Mã</strong> + <strong>Giá trị</strong>.
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
        title="Loại tài liệu"
        field="Chọn loại tài liệu"
        description="Dropdown bắt buộc khi tạo review."
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
              const label = `Loại tài liệu mới ${n}`;
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
        title="Loại hợp đồng"
        field="Loại hợp đồng (Contract type)"
        description="Dropdown trên form tạo. Checklist / Matrix chi tiết ở Cấu hình loại HĐ."
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
              id: code.trim() || contractTypes[index].id,
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
              const label = `Loại HĐ mới ${n}`;
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
                contractTypes: state.contractTypes.filter(
                  (t) => t.label.trim() && t.id.trim()
                ),
              })
            }
          >
            <Save className="mr-2 h-4 w-4" />
            Lưu
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/dashboard/config">
              <ExternalLink className="mr-2 h-4 w-4" />
              Checklist / Matrix chi tiết
            </Link>
          </Button>
        </div>
      </Section>

      <Section
        title="Tên hợp đồng (Contract name)"
        field="Tên hợp đồng (Contract name)"
        description="Dropdown bắt buộc trên form tạo review."
      >
        <ValueTable
          rows={state.contractNames.map((n) => ({
            key: n.id,
            code: n.code,
            value: n.label,
          }))}
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
              setState({
                ...state,
                contractNames: [
                  ...state.contractNames,
                  {
                    id: slugId("cn", label),
                    code: `CN${n}`,
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
                contractNames: state.contractNames.filter(
                  (n) => n.label.trim() && n.code.trim()
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
        title="Business Entity"
        field="Business Entity"
        description="Dropdown bắt buộc trên form tạo review."
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
              const label = `Business Entity ${n}`;
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
        title="Contract base"
        field="Contract base"
        description="Dropdown bắt buộc trên form tạo review."
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
              const label = `Contract base ${n}`;
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
        title="Hợp đồng có chiết khấu"
        field="Hợp đồng có chiết khấu"
        description="Mã nội bộ (yes/no) cố định — chỉnh nhãn hiển thị ở Giá trị."
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
