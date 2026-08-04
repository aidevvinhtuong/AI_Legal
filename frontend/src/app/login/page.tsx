"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { loginAs } from "@/lib/review-service";
import type { UserRole } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";
import { Briefcase, Gavel, Loader2, Server, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState<UserRole | null>(null);

  const handleLogin = async (role: UserRole) => {
    setLoading(role);
    try {
      await loginAs(role);
      if (role === "it") {
        router.push("/dashboard/configurations");
      } else if (role === "legal" || role === "legal_lead") {
        router.push("/dashboard/legal");
      } else {
        router.push("/dashboard");
      }
    } catch (e) {
      toast({
        title: "Đăng nhập thất bại",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
      <Card className="w-full max-w-lg shadow-md">
        <CardHeader className="text-center space-y-3">
          <img src="/logo.png" alt="Saint-Gobain" className="mx-auto w-20 h-20" />
          <CardTitle>AI Review Hợp đồng</CardTitle>
          <CardDescription>
            Demo theo vai trò. IT quyền cao nhất · Legal Lead Publish cấu hình · chỉ IT xem Configurations.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button
            size="lg"
            className="h-14 justify-start gap-3"
            disabled={!!loading}
            onClick={() => handleLogin("purchasing")}
          >
            {loading === "purchasing" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Briefcase className="h-5 w-5" />
            )}
            <div className="text-left">
              <div className="font-medium">Phòng Mua hàng</div>
              <div className="text-xs opacity-80">Tạo review, chỉnh sửa, gửi Legal</div>
            </div>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 justify-start gap-3"
            disabled={!!loading}
            onClick={() => handleLogin("legal")}
          >
            {loading === "legal" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Gavel className="h-5 w-5" />
            )}
            <div className="text-left">
              <div className="font-medium">Legal</div>
              <div className="text-xs text-muted-foreground">
                Duyệt HĐ · tạo/sửa Draft cấu hình (không Publish)
              </div>
            </div>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 justify-start gap-3"
            disabled={!!loading}
            onClick={() => handleLogin("legal_lead")}
          >
            {loading === "legal_lead" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ShieldCheck className="h-5 w-5" />
            )}
            <div className="text-left">
              <div className="font-medium">Legal Lead</div>
              <div className="text-xs text-muted-foreground">
                Publish cấu hình · duyệt HĐ · quản trị checklist
              </div>
            </div>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 justify-start gap-3 border-slate-800/20"
            disabled={!!loading}
            onClick={() => handleLogin("it")}
          >
            {loading === "it" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Server className="h-5 w-5" />
            )}
            <div className="text-left">
              <div className="font-medium">IT</div>
              <div className="text-xs text-muted-foreground">
                Quyền cao nhất · Configurations · Publish cấu hình · duyệt HĐ
              </div>
            </div>
          </Button>
          <p className="text-xs text-muted-foreground text-center pt-2">
            Kết quả AI chỉ là gợi ý, không thay thế rà soát pháp lý chính thức.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
