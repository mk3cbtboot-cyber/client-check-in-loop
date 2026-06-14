import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ChatThread, { type ChatMessage } from "./ChatThread";

interface Props {
  clientId: string;
  clientName: string;
  onRead?: () => void;
}

export default function PractitionerMessages({ clientId, clientName, onRead }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender, body, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });
    if (!error && data) {
      // Dedupe by id in case a realtime INSERT landed before the initial fetch.
      setMessages((prev) => {
        const seen = new Map<string, ChatMessage>();
        for (const m of data as ChatMessage[]) seen.set(m.id, m);
        for (const m of prev) if (!seen.has(m.id)) seen.set(m.id, m);
        return Array.from(seen.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    onRead?.();
    const channel = supabase
      .channel(`messages-${clientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          if (row.sender === "client") onRead?.();
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const send = async (body: string) => {
    setSending(true);
    const { error } = await supabase.from("messages").insert({ client_id: clientId, sender: "practitioner", body });
    setSending(false);
    if (error) toast.error("Couldn't send reply.");
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading conversation…</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Conversation with {clientName}. AI placeholder replies are shown inline.</p>
      <ChatThread
        messages={messages}
        viewerRole="practitioner"
        onSend={send}
        sending={sending}
        placeholder={`Reply to ${clientName.split(" ")[0]}…`}
        emptyHint="No messages from this client yet."
      />
    </div>
  );
}
