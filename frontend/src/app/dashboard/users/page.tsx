"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  PERMISSION_CATALOG,
  defaultPermissionsForRole,
  permissionLabels,
} from "@/lib/permissions";
import { getSession } from "@/lib/review-service";
import { canAccessUsers } from "@/lib/roles";
import type { AppUser, PermissionKey, UserDepartment, UserRole } from "@/lib/types";
import {
  USER_DEPARTMENTS,
  USER_ROLES,
  createUser,
  deleteUser,
  emptyUserInput,
  loadUsers,
  roleLabel,
  updateUser,
  type UserInput,
} from "@/lib/user-store";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export default function UsersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserInput>(emptyUserInput());
  const [saving, setSaving] = useState(false);

  const refresh = () => setUsers(loadUsers());

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.push("/login");
      return;
    }
    if (!canAccessUsers(session)) {
      toast({
        title: "Không có quyền quản lý Users",
        variant: "destructive",
      });
      router.push("/dashboard");
      return;
    }
    refresh();
    setLoading(false);
  }, [router, toast]);

  const managerOptions = useMemo(
    () =>
      users.filter(
        (u) =>
          u.active &&
          (u.role === "purchasing_manager" ||
            u.role === "legal" ||
            u.role === "it") &&
          u.id !== editingId
      ),
    [users, editingId]
  );

  const permGroups = useMemo(() => {
    const map = new Map<string, typeof PERMISSION_CATALOG>();
    for (const p of PERMISSION_CATALOG) {
      const list = map.get(p.group) || [];
      list.push(p);
      map.set(p.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyUserInput());
    setOpen(true);
  };

  const openEdit = (u: AppUser) => {
    setEditingId(u.id);
    setForm({
      username: u.username,
      fullName: u.fullName || "",
      password: "",
      email: u.email,
      phone: u.phone,
      department: u.department,
      role: u.role,
      lineManagerId: u.lineManagerId,
      permissions: [...u.permissions],
      active: u.active,
    });
    setOpen(true);
  };

  const togglePerm = (key: PermissionKey, checked: boolean) => {
    setForm((f) => {
      const set = new Set(f.permissions);
      if (checked) set.add(key);
      else set.delete(key);
      return {
        ...f,
        permissions: PERMISSION_CATALOG.map((p) => p.key).filter((k) =>
          set.has(k)
        ),
      };
    });
  };

  const handleRoleChange = (role: UserRole) => {
    setForm((f) => ({
      ...f,
      role,
      permissions: defaultPermissionsForRole(role),
    }));
  };

  const handleSave = () => {
    setSaving(true);
    try {
      if (editingId) {
        updateUser(editingId, form);
        toast({ title: "Đã cập nhật user" });
      } else {
        createUser(form);
        toast({ title: "Đã tạo user" });
      }
      setOpen(false);
      refresh();
    } catch (e) {
      toast({
        title: "Lỗi",
        description: e instanceof Error ? e.message : "Không lưu được",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (u: AppUser) => {
    if (!confirm(`Xóa user "${u.username}"?`)) return;
    try {
      deleteUser(u.id);
      toast({ title: "Đã xóa user" });
      refresh();
    } catch (e) {
      toast({
        title: "Lỗi",
        description: e instanceof Error ? e.message : "Không xóa được",
        variant: "destructive",
      });
    }
  };

  const managerName = (id?: string) => {
    if (!id) return "—";
    const u = users.find((x) => x.id === id);
    if (!u) return id;
    return u.fullName ? `${u.fullName} (${u.username})` : u.username;
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Users className="h-6 w-6" />
              Users
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              IT tạo / sửa tài khoản, gán Role và tick phân quyền theo hạng mục.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            Thêm user
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Danh sách user ({users.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2.5 pr-3 font-medium">Username</th>
                    <th className="py-2.5 pr-3 font-medium">Họ tên</th>
                    <th className="py-2.5 pr-3 font-medium">Role</th>
                    <th className="py-2.5 pr-3 font-medium">Quyền</th>
                    <th className="py-2.5 pr-3 font-medium">Line Manager</th>
                    <th className="py-2.5 pr-3 font-medium">Active</th>
                    <th className="py-2.5 font-medium w-28">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{u.username}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.email || "—"} · {u.department}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 font-medium">
                        {u.fullName || "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant="secondary">{roleLabel(u.role)}</Badge>
                      </td>
                      <td className="py-2.5 pr-3 max-w-[280px]">
                        <p
                          className="text-xs text-muted-foreground line-clamp-2"
                          title={permissionLabels(u.permissions)}
                        >
                          {u.permissions.length} hạng mục:{" "}
                          {permissionLabels(u.permissions)}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        {managerName(u.lineManagerId)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={u.active ? "default" : "destructive"}>
                          {u.active ? "True" : "False"}
                        </Badge>
                      </td>
                      <td className="py-2.5">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(u)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => handleDelete(u)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[70vw] max-w-[70vw] max-h-[63vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Sửa user" : "Tạo user mới"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                value={form.username}
                onChange={(e) =>
                  setForm((f) => ({ ...f, username: e.target.value }))
                }
                placeholder="vd: van.a"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Họ tên</Label>
              <Input
                value={form.fullName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fullName: e.target.value }))
                }
                placeholder="vd: Nguyễn Văn A"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Password{" "}
                {editingId && (
                  <span className="text-muted-foreground font-normal">
                    (để trống nếu không đổi)
                  </span>
                )}
              </Label>
              <Input
                type="password"
                value={form.password || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder={editingId ? "••••••••" : "Mật khẩu IT set"}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone number</Label>
                <Input
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select
                  value={form.department}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      department: v as UserDepartment,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => handleRoleChange(v as UserRole)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Đổi Role sẽ nạp lại bộ quyền mặc định — IT có thể tick chỉnh
                  bên dưới.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Line Manager</Label>
              <Select
                value={form.lineManagerId || "__none__"}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    lineManagerId: v === "__none__" ? undefined : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không có —</SelectItem>
                  {managerOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName || u.username} ({roleLabel(u.role)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Active</Label>
              <Select
                value={form.active ? "true" : "false"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, active: v === "true" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">True</SelectItem>
                  <SelectItem value="false">False</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border p-3 space-y-3">
              <div>
                <Label className="text-sm">Phân quyền theo hạng mục</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tick để mở từng chức năng / cấu hình.
                </p>
              </div>
              {permGroups.map(([group, items]) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </p>
                  <ul className="space-y-2">
                    {items.map((p) => {
                      const checked = form.permissions.includes(p.key);
                      return (
                        <li key={p.key}>
                          <label
                            className={cn(
                              "flex items-start gap-2.5 rounded-md border px-2.5 py-2 cursor-pointer hover:bg-muted/50",
                              checked && "border-sky-300 bg-sky-50/60"
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-sky-700"
                              checked={checked}
                              onChange={(e) =>
                                togglePerm(p.key, e.target.checked)
                              }
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">
                                {p.label}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {p.description}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
