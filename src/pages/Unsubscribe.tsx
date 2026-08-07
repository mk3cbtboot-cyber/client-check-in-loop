import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

type State = "loading" | "confirm" | "done" | "already" | "invalid";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe`;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("loading");
  const [email, setEmail] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Unsubscribe | Tenacia";
    let cancelled = false;
    (async () => {
      if (!token) {
        setState("invalid");
        return;
      }
      let result: any = null;
      try {
        const res = await fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, {
          headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
        });
        result = await res.json();
      } catch {
        result = null;
      }
      if (cancelled) return;
      if (!result?.valid) {
        setState("invalid");
        return;
      }
      setEmail(result.email ?? "");
      setState(result.alreadyUnsubscribed ? "already" : "confirm");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
          },
          body: JSON.stringify({ token }),
        },
      );
      const out = await res.json();
      setState(out?.ok ? "done" : "invalid");
    } catch {
      setState("invalid");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border bg-card p-8 text-card-foreground shadow-sm">
        {state === "loading" && <p className="text-muted-foreground">Checking your link...</p>}

        {state === "confirm" && (
          <>
            <h1 className="text-2xl font-semibold mb-3">Unsubscribe from Tenacia emails</h1>
            <p className="text-muted-foreground mb-6">
              {email
                ? `Confirm that ${email} should no longer receive emails from Tenacia.`
                : "Confirm that this address should no longer receive emails from Tenacia."}
            </p>
            <Button onClick={confirm} disabled={busy}>
              {busy ? "Unsubscribing..." : "Unsubscribe"}
            </Button>
          </>
        )}

        {(state === "done" || state === "already") && (
          <>
            <h1 className="text-2xl font-semibold mb-3">You're unsubscribed</h1>
            <p className="text-muted-foreground">
              You won't receive further emails from Tenacia at this address. If this was a mistake,
              contact your practitioner and they can re-add you.
            </p>
          </>
        )}

        {state === "invalid" && (
          <>
            <h1 className="text-2xl font-semibold mb-3">Link not valid</h1>
            <p className="text-muted-foreground">
              This unsubscribe link is invalid or has expired. If you need help, contact your
              practitioner.
            </p>
          </>
        )}
      </section>
    </main>
  );
};

export default Unsubscribe;
