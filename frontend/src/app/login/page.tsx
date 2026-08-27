"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeOwnPassword,
  loginWithCredentials,
} from "@/lib/services/reviews";
import type { UserSession } from "@/lib/domain/types";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "change">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectByRole = (user: UserSession) => {
    if (user.role === "it") {
      router.push("/dashboard/configurations");
    } else if (user.role === "legal") {
      router.push("/dashboard/tasks");
    } else if (user.role === "purchasing_manager") {
      router.push("/dashboard/tasks");
    } else {
      router.push("/dashboard");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!username.trim() || !password) {
      setError("Nhập tài khoản và mật khẩu.");
      return;
    }
    setSubmitting(true);
    try {
      const user = await loginWithCredentials(username, password);
      redirectByRole(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại");
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!username.trim() || !oldPassword || !newPassword) {
      setError("Điền đủ username, mật khẩu cũ và mật khẩu mới.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Mật khẩu mới và xác nhận không khớp.");
      return;
    }
    setSubmitting(true);
    try {
      await changeOwnPassword(username, oldPassword, newPassword);
      setSuccess("Đổi mật khẩu thành công. Đăng nhập bằng mật khẩu mới.");
      setMode("login");
      setPassword("");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đổi mật khẩu thất bại");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="text-center space-y-3">
          <img src="/logo.png" alt="Saint-Gobain" className="mx-auto w-20 h-20" />
          <CardTitle>AI Review Hợp đồng</CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Đăng nhập bằng tài khoản được IT cấp."
              : "Đổi mật khẩu tài khoản của bạn."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">Tài khoản</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  placeholder="Nhập tài khoản"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Mật khẩu</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Nhập mật khẩu"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              {success && (
                <p className="text-sm text-emerald-700" role="status">
                  {success}
                </p>
              )}
              <Button type="submit" className="w-full h-11" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <LogIn className="h-4 w-4 mr-2" />
                )}
                Đăng nhập
              </Button>
              <button
                type="button"
                className="w-full text-sm text-primary hover:underline"
                onClick={() => {
                  setMode("change");
                  setError(null);
                  setSuccess(null);
                }}
              >
                Đổi mật khẩu
              </button>
            </form>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cp-username">Tài khoản</Label>
                <Input
                  id="cp-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-old">Mật khẩu cũ</Label>
                <Input
                  id="cp-old"
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-new">Mật khẩu mới</Label>
                <Input
                  id="cp-new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-confirm">Xác nhận mật khẩu mới</Label>
                <Input
                  id="cp-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full h-11" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <KeyRound className="h-4 w-4 mr-2" />
                )}
                Lưu mật khẩu mới
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:underline"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                ← Quay lại đăng nhập
              </button>
            </form>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Kết quả AI chỉ là gợi ý, không thay thế rà soát pháp lý chính thức.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
