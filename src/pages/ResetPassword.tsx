import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

type Status = "checking" | "ready" | "invalid" | "success";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let resolved = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && !resolved)) {
        resolved = true;
        setStatus("ready");
      }
    });

    // Fallback: check existing session (supabase-js parses the URL hash on load).
    supabase.auth.getSession().then(({ data }) => {
      if (resolved) return;
      if (data.session) {
        resolved = true;
        setStatus("ready");
      } else {
        // Give supabase-js a moment to parse the hash, then decide.
        setTimeout(() => {
          if (resolved) return;
          supabase.auth.getSession().then(({ data: d2 }) => {
            if (resolved) return;
            resolved = true;
            setStatus(d2.session ? "ready" : "invalid");
          });
        }, 800);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setStatus("success");
      setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-6 space-y-6">
        {status === "checking" && (
          <div>
            <h1 className="text-2xl font-semibold">Checking your reset link</h1>
            <p className="text-sm text-muted-foreground mt-2">One moment…</p>
          </div>
        )}

        {status === "invalid" && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold">This reset link is invalid or has expired</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Reset links can only be used once and expire after a short time.
              </p>
            </div>
            <Link
              to="/forgot-password"
              className="text-sm text-muted-foreground hover:text-foreground block text-center"
            >
              Request a new reset link
            </Link>
          </div>
        )}

        {status === "success" && (
          <div>
            <h1 className="text-2xl font-semibold">Password updated</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Taking you to your dashboard…
            </p>
          </div>
        )}

        {status === "ready" && (
          <>
            <div>
              <h1 className="text-2xl font-semibold">Choose a new password</h1>
              <p className="text-sm text-muted-foreground">
                Use at least 8 characters.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
