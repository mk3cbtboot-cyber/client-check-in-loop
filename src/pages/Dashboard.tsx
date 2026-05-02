import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";

interface Client {
  id: string;
  name: string;
  email: string;
  magic_token: string;
  created_at: string;
}

interface CheckIn {
  id: string;
  client_id: string;
  feeling: number;
  water_glasses: number;
  notes: string | null;
  created_at: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [checkIns, setCheckIns] = useState<Record<string, CheckIn[]>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate("/auth", { replace: true });
        return;
      }
      setUserEmail(data.session.user.email ?? "");
      load();
    });
  }, [navigate]);

  const load = async () => {
    const { data: clientRows } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    setClients(clientRows ?? []);
    if (clientRows && clientRows.length) {
      const { data: checkRows } = await supabase
        .from("check_ins")
        .select("*")
        .in("client_id", clientRows.map((c) => c.id))
        .order("created_at", { ascending: false });
      const grouped: Record<string, CheckIn[]> = {};
      (checkRows ?? []).forEach((ci) => {
        (grouped[ci.client_id] ||= []).push(ci);
      });
      setCheckIns(grouped);
    }
  };

  const addClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-client", {
        body: { name, email },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Client invited — magic link emailed");
      setName("");
      setEmail("");
      setOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to invite client");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Tenacia</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <Button variant="outline" size="sm" onClick={logout}>Log out</Button>
        </div>
      </header>

      <section className="max-w-5xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Clients</h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Add client</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a new client</DialogTitle>
              </DialogHeader>
              <form onSubmit={addClient} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cname">Name</Label>
                  <Input id="cname" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cemail">Email</Label>
                  <Input id="cemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Sending invite…" : "Add & send invite"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {clients.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">No clients yet. Add your first one.</Card>
        ) : (
          <div className="space-y-4">
            {clients.map((client) => {
              const list = checkIns[client.id] ?? [];
              const link = `${window.location.origin}/checkin/${client.magic_token}`;
              return (
                <Card key={client.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{client.name}</p>
                      <p className="text-sm text-muted-foreground">{client.email}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(link);
                        toast.success("Magic link copied");
                      }}
                    >
                      Copy link
                    </Button>
                  </div>
                  <div className="border-t pt-3">
                    <p className="text-sm font-medium mb-2">
                      Check-ins ({list.length})
                    </p>
                    {list.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No submissions yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {list.map((ci) => (
                          <li key={ci.id} className="text-sm border rounded p-3 space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{format(new Date(ci.created_at), "PPp")}</span>
                            </div>
                            <div>Feeling: <span className="font-medium">{ci.feeling}/5</span></div>
                            <div>Water: <span className="font-medium">{ci.water_glasses} glasses</span></div>
                            {ci.notes && <div className="pt-1 text-muted-foreground">"{ci.notes}"</div>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
