"use client";

import { Suspense } from "react";
import LegalInboxPage from "./legal-inbox";

export default function LegalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Đang tải...
        </div>
      }
    >
      <LegalInboxPage />
    </Suspense>
  );
}
