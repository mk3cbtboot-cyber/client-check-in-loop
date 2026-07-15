import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function db(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_messages",
  title: "List messages with a client",
  description: "Return the most recent chat messages between the practitioner and a client, oldest first.",
  inputSchema: {
    client_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).optional().describe("Max messages to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const { data, error } = await db(ctx)
      .from("messages")
      .select("id, sender, body, created_at")
      .eq("client_id", client_id)
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const ordered = (data ?? []).slice().reverse();
    return {
      content: [{ type: "text", text: JSON.stringify(ordered, null, 2) }],
      structuredContent: { messages: ordered },
    };
  },
});
