"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  getConfigPermission,
  listParentCategories,
  listSigningRules,
  saveSigningRules,
  validateSigningRules,
} from "@/lib/services/config";
import type {
  ContractParentCategory,
  SigningAuthorityRule,
  SigningSlotRole,
} from "@/lib/domain/config-types";
import { fetchFormLists } from "@/lib/services/form-lists";
import type { CodeLabelOption } from "@/lib/domain/form-lists";
import type { UserDirectoryEntry } from "@/lib/domain/types";
import { fetchUserDirectory } from "@/lib/services/users";
import { Check, ChevronDown, Loader2, Plus, Save, Trash2 } from "lucide-react";

function newRule(
  defaults?: Partial<SigningAuthorityRule>
): SigningAuthorityRule {
  return {
    id: `sar_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    businessEntityIds: [],
    documentCategoryId: "",
    minValue: 0,
    maxValue: null,
    ecRole: "reviewer",
    userId: "",
    personalName: "",
    email: "",
    telephoneNumber: "",
    signType: "review",
    order: 1,
    ...defaults,
  };
}

function formatMoneyDots(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseMoneyDots(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  return Number(digits);
}

function UserSearchSelect({
  users,
  value,
  disabled,
  onChange,
}: {
  users: UserDirectoryEntry[];
  value: string;
  disabled?: boolean;
  onChange: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = users.find((u) => u.id === value);
  const label = selected
    ? `${selected.fullName} (${selected.email})`
    : "Chọn user…";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
    );
  }, [users, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1"
      >
        <span
          className={
            selected ? "truncate text-left" : "truncate text-muted-foreground"
          }
        >
          {label}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[16rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="border-b p-1.5">
            <Input
              ref={inputRef}
              className="h-8 text-xs"
              placeholder="Gõ tên / email để tìm…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div className="max-h-56 overflow-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                Không tìm thấy user
              </div>
            ) : (
              filtered.map((u) => {
                const checked = u.id === value;
                return (
                  <button
                    key={u.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      onChange(u.id);
                      setOpen(false);
                    }}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {checked ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="truncate text-left">
                      {u.fullName} ({u.email})
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyMultiSelect({
  companies,
  value,
  disabled,
  onChange,
  displayLabel,
}: {
  companies: CodeLabelOption[];
  value: string[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
  displayLabel: (ids: string[]) => string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  const label = value.length ? displayLabel(value) : "Chọn công ty…";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1"
      >
        <span
          className={
            value.length ? "truncate text-left" : "truncate text-muted-foreground"
          }
        >
          {label}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full min-w-[12rem] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {companies.map((c) => {
            const checked = value.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => toggle(c.id)}
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {checked ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="truncate text-left">
                  {c.code} — {c.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SigningRulesPanel() {
  const { toast } = useToast();
  const perm = getConfigPermission();
  const canEdit = perm.canEditDraft;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<SigningAuthorityRule[]>([]);
  const [parents, setParents] = useState<ContractParentCategory[]>([]);
  const [companies, setCompanies] = useState<CodeLabelOption[]>([]);
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);

  useEffect(() => {
    // `allSettled`, KHÔNG `all`: bốn nguồn này độc lập nhau, nên một cái hỏng
    // không có lý do gì làm trắng cả bảng. Trước đây `fetchUsers()` trả 403 cho
    // Legal và kéo theo cả rules/parents/companies cùng rỗng — người dùng thấy
    // "Chưa có dòng" trong khi dữ liệu vẫn còn nguyên trong DB.
    void Promise.allSettled([
      listSigningRules(),
      listParentCategories(),
      fetchFormLists(),
      fetchUserDirectory(),
    ])
      .then(([r, p, lists, dir]) => {
        if (r.status === "fulfilled") setRules(r.value);
        if (p.status === "fulfilled") setParents(p.value);
        if (lists.status === "fulfilled") {
          setCompanies(
            lists.value.businessEntities.filter((c) => c.status !== "archived")
          );
        }
        if (dir.status === "fulfilled") {
          setUsers(dir.value.filter((u) => u.active));
        }

        const failed = [
          [r, "bảng phân quyền ký"],
          [p, "danh mục Loại hợp đồng"],
          [lists, "Form lists"],
          [dir, "danh bạ người dùng"],
        ] as const;
        const errors = failed
          .filter(([res]) => res.status === "rejected")
          .map(([res, label]) => {
            const reason = (res as PromiseRejectedResult).reason;
            return `${label}: ${reason instanceof Error ? reason.message : "Lỗi"}`;
          });
        if (errors.length) {
          toast({
            title: "Một số dữ liệu không tải được",
            description: errors.join(" · "),
            variant: "destructive",
          });
        }
      })
      .finally(() => setLoading(false));
  }, [toast]);

  const companyLabel = useMemo(() => {
    const map = new Map(companies.map((c) => [c.id, c.code || c.label]));
    return (ids: string[]) =>
      ids.length ? ids.map((id) => map.get(id) || id).join(", ") : "—";
  }, [companies]);

  const updateRow = (id: string, patch: Partial<SigningAuthorityRule>) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const pickUser = (rowId: string, userId: string) => {
    const u = users.find((x) => x.id === userId);
    if (!u) return;
    updateRow(rowId, {
      userId: u.id,
      personalName: u.fullName || u.username,
      email: u.email,
      telephoneNumber: u.phone || "",
    });
  };

  const setRole = (rowId: string, ecRole: SigningSlotRole) => {
    updateRow(rowId, {
      ecRole,
      signType: ecRole === "reviewer" ? "review" : "sign_fca.passcode",
    });
  };

  const handleSave = async () => {
    const errors = validateSigningRules(rules);
    if (errors.length) {
      toast({
        title: "Không lưu được",
        description: errors[0],
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSigningRules(rules);
      setRules(saved);
      toast({ title: "Đã lưu bảng phân quyền ký" });
    } catch (e) {
      toast({
        title: "Lỗi lưu",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setRules((prev) => [
                ...prev,
                newRule({
                  documentCategoryId: parents[0]?.id || "",
                  businessEntityIds: companies[0] ? [companies[0].id] : [],
                  order: prev.length + 1,
                }),
              ])
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Thêm dòng
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Lưu
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Bảng điều kiện phân quyền
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-medium w-[180px]">Công ty</th>
                  <th className="py-2 pr-2 font-medium w-[180px]">
                    Loại hợp đồng
                  </th>
                  <th className="py-2 pr-2 font-medium w-[120px]">
                    Giá trị min
                  </th>
                  <th className="py-2 pr-2 font-medium w-[120px]">
                    Giá trị max
                  </th>
                  <th className="py-2 pr-2 font-medium w-[140px]">Quyền</th>
                  <th className="py-2 pr-2 font-medium">
                    Người xem xét/Ký chính
                  </th>
                  {canEdit && <th className="py-2 font-medium w-12"></th>}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-2">
                      {canEdit ? (
                        <CompanyMultiSelect
                          companies={companies}
                          value={r.businessEntityIds}
                          displayLabel={companyLabel}
                          onChange={(businessEntityIds) =>
                            updateRow(r.id, { businessEntityIds })
                          }
                        />
                      ) : (
                        <span className="text-xs">
                          {companyLabel(r.businessEntityIds)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <Select
                        value={r.documentCategoryId || undefined}
                        disabled={!canEdit}
                        onValueChange={(documentCategoryId) =>
                          updateRow(r.id, { documentCategoryId })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Chọn loại HĐ…" />
                        </SelectTrigger>
                        <SelectContent>
                          {parents.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        className="h-8 text-xs"
                        inputMode="numeric"
                        disabled={!canEdit}
                        value={formatMoneyDots(r.minValue ?? 0)}
                        onChange={(e) => {
                          const n = parseMoneyDots(e.target.value);
                          updateRow(r.id, { minValue: n ?? 0 });
                        }}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        className="h-8 text-xs"
                        inputMode="numeric"
                        disabled={!canEdit}
                        placeholder="∞"
                        value={formatMoneyDots(r.maxValue)}
                        onChange={(e) => {
                          updateRow(r.id, {
                            maxValue: parseMoneyDots(e.target.value),
                          });
                        }}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Select
                        value={r.ecRole}
                        disabled={!canEdit}
                        onValueChange={(v) =>
                          setRole(r.id, v as SigningSlotRole)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="reviewer">Xem xét</SelectItem>
                          <SelectItem value="signer">Ký chính</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      {canEdit ? (
                        <UserSearchSelect
                          users={users}
                          value={r.userId}
                          onChange={(userId) => pickUser(r.id, userId)}
                        />
                      ) : (
                        <span className="text-xs">
                          {r.personalName
                            ? `${r.personalName} (${r.email})`
                            : "—"}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={rules.length <= 1}
                          onClick={() =>
                            setRules((prev) =>
                              prev.filter((x) => x.id !== r.id)
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {!rules.length && (
                  <tr>
                    <td
                      colSpan={canEdit ? 7 : 6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Chưa có dòng — bấm Thêm dòng để cấu hình.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Giá trị max để trống = không giới hạn. Khi áp dụng ma trận trên
            ticket, hệ thống lấy mọi dòng khớp Công ty + Loại HĐ + giá trị nằm
            trong [min, max].
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
