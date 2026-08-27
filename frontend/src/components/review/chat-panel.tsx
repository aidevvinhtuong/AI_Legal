"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export function ChatPanel({
  messages,
  onSend,
  disabled,
}: {
  messages: ChatMessage[];
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending || disabled) return;
    setSending(true);
    try {
      await onSend(input.trim());
      setInput("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto space-y-3 p-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex gap-2 text-sm",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {m.role === "assistant" && (
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              {m.content}
            </div>
            {m.role === "user" && (
              <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="border-t p-3 flex gap-2">
        <input
          className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Yêu cầu AI sửa thêm một đoạn..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || sending}
        />
        <Button type="submit" size="icon" disabled={disabled || sending || !input.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
