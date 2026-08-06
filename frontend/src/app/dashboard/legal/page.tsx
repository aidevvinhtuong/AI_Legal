"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Route cũ — redirect sang màn Task chung (giữ query ?focus=). */
function LegalRedirect() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const focus = search.get("focus");
    router.replace(focus ? `/dashboard/tasks?focus=${focus}` : "/dashboard/tasks");
  }, [router, search]);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Đang chuyển sang màn Task...
    </div>
  );
}

export default function LegalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Đang tải...
        </div>
      }
    >
      <LegalRedirect />
    </Suspense>
  );
}
