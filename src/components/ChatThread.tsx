import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Send, Sparkles } from "lucide-react";

export interface ChatMessage {
  id: string;
  sender: "client" | "practitioner" | "ai";
  body: string;
  created_at: string;
  notice?: string | null;
}


interface Props {
  messages: ChatMessage[];
  // The role of the current viewer — determines which side a message appears on.
  viewerRole: "client" | "practitioner";
  onSend: (body: string) => Promise<void> | void;
  sending?: boolean;
  placeholder?: string;
  emptyHint?: string;
}

export default function ChatThread({ messages, viewerRole, onSend, sending, placeholder, emptyHint }: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await onSend(text);
  };

  return (
    <div className="flex flex-col h-[60vh] min-h-[420px] rounded-lg border bg-card">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            {emptyHint ?? "No messages yet. Say hello."}
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender === viewerRole;
          const isAi = m.sender === "ai";
          const align = mine ? "items-end" : "items-start";
          const bubble = isAi
            ? "bg-accent text-accent-foreground"
            : mine
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground";
          const label = isAi ? "AI assistant" : m.sender === "practitioner" ? "Cheryl" : "You";
          return (
            <div key={m.id} className={`flex flex-col ${align}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${bubble}`}>
                {isAi && (
                  <div className="flex items-center gap-1 mb-1 text-xs opacity-80">
                    <Sparkles className="h-3 w-3" /> {label}
                  </div>
                )}
                {m.body}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 px-1">
                {!isAi && `${mine ? "You" : label} · `}
                {format(new Date(m.created_at), "MMM d, p")}
              </p>
              {m.notice && (
                <p className="max-w-[80%] mt-1 px-3 py-2 rounded-md bg-muted/60 text-xs text-muted-foreground italic">
                  {m.notice}
                </p>
              )}
            </div>
          );
        })}

      </div>
      <div className="border-t p-3 flex gap-2 items-end">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder ?? "Write a message…"}
          className="min-h-[44px] max-h-32 resize-none"
        />
        <Button onClick={submit} disabled={sending || !draft.trim()} size="icon" aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
