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
  name: "send_message",
  title: "Send message to client",
  description: "Send a chat message from the signed-in practitioner to one of their clients.",
  inputSchema: {
    client_id: z.string().uuid(),
    body: z.string().trim().min(1).describe("Message text to send."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ client_id, body }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const { data, error } = await db(ctx)
      .from("messages")
      .insert({ client_id, sender: "practitioner", body })
      .select("id, created_at")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Sent. id=${data?.id}` }],
      structuredContent: { message: data },
    };
  },
});
