"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Loader2 } from "lucide-react";

/** Redirect cũ → Configurations tab Phân quyền ký. */
export default function SigningRulesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/configurations?tab=signing");
  }, [router]);

  return (
    <AppLayout>
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Đang chuyển tới Configurations…
      </div>
    </AppLayout>
  );
}
