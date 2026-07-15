import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// The `auth.oauth` namespace on supabase-js is currently in beta and not fully
// typed. Wrap the three methods we call so the consent flow stays type-safe.
type AuthorizationDetails = {
  client?: { name?: string; redirect_uri?: string; client_id?: string };
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthResult = { redirect_url?: string; redirect_to?: string };
interface OAuthClient {
  getAuthorizationDetails(id: string): Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization(id: string): Promise<{ data: OAuthResult | null; error: { message: string } | null }>;
  denyAuthorization(id: string): Promise<{ data: OAuthResult | null; error: { message: string } | null }>;
}
const oauth = (supabase.auth as unknown as { oauth: OAuthClient }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      setUserEmail(sess.session.user.email ?? null);
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("No redirect returned by the authorization server.");
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-6 space-y-4">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">Couldn't load this authorization</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </>
        ) : !details ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold">
                Connect {details.client?.name ?? "an app"} to Tenacia
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {details.client?.name ?? "The requesting app"} will be able to call Tenacia's enabled
                tools while you are signed in as {userEmail ?? "your account"}.
              </p>
            </div>
            <div className="text-sm space-y-1">
              <p className="text-muted-foreground">This does not bypass Tenacia's permissions or backend policies.</p>
              {details.scopes?.length ? (
                <p className="text-xs text-muted-foreground">Requested scopes: {details.scopes.join(", ")}</p>
              ) : null}
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => decide(true)} disabled={busy} className="flex-1">
                Approve
              </Button>
              <Button onClick={() => decide(false)} disabled={busy} variant="outline" className="flex-1">
                Cancel connection
              </Button>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
