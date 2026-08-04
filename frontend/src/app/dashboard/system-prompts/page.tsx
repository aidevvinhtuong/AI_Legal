"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route → Configurations (System prompts tab). */
export default function SystemPromptsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/configurations?tab=system-prompts");
  }, [router]);
  return null;
}
