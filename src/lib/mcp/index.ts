import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listClients from "./tools/list-clients";
import getClient from "./tools/get-client";
import listMessages from "./tools/list-messages";
import sendMessage from "./tools/send-message";
import listCheckins from "./tools/list-checkins";

// Direct Supabase issuer is required — never the .lovable.cloud proxy.
// Vite inlines VITE_SUPABASE_PROJECT_ID at build time so this stays import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "tenacia-mcp",
  title: "Tenacia MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Tenacia nutrition-coaching app. Callers act as the signed-in practitioner: list their clients, read a client's profile and check-ins, and send chat messages. All data access is scoped by the app's row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listClients, getClient, listMessages, sendMessage, listCheckins],
});
