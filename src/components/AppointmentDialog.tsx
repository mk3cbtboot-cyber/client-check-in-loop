import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

export interface Appointment {
  id: string;
  client_id: string;
  practitioner_id: string;
  title: string;
  scheduled_at: string;
  notes: string | null;
  status?: "scheduled" | "attended" | "missed" | null;
  attended_at?: string | null;
  missed_flagged_at?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  practitionerId: string;
  appointment: Appointment | null;
  onSaved: () => void;
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function AppointmentDialog({
  open,
  onOpenChange,
  clientId,
  practitionerId,
  appointment,
  onSaved,
}: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (appointment) {
      setTitle(appointment.title);
      setDate(toLocalDate(appointment.scheduled_at));
      setTime(toLocalTime(appointment.scheduled_at));
      setNotes(appointment.notes ?? "");
    } else {
      setTitle("");
      setDate("");
      setTime("");
      setNotes("");
    }
  }, [open, appointment]);

  const save = async () => {
    if (!title.trim()) {
      toast.error("Appointment name is required");
      return;
    }
    if (!date || !time) {
      toast.error("Date and time are required");
      return;
    }
    const scheduled = new Date(`${date}T${time}`);
    if (isNaN(scheduled.getTime())) {
      toast.error("Invalid date or time");
      return;
    }
    setSaving(true);
    try {
      if (appointment) {
        const { error } = await supabase
          .from("appointments")
          .update({
            title: title.trim(),
            scheduled_at: scheduled.toISOString(),
            notes: notes.trim() || null,
            // Rescheduling clears any missed flag and resets to scheduled
            status: "scheduled",
            missed_flagged_at: null,
          } as never)
          .eq("id", appointment.id);
        if (error) throw error;
        toast.success("Appointment updated");
      } else {
        const { error } = await supabase.from("appointments").insert({
          client_id: clientId,
          practitioner_id: practitionerId,
          title: title.trim(),
          scheduled_at: scheduled.toISOString(),
          notes: notes.trim() || null,
        });
        if (error) throw error;
        toast.success("Appointment booked");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save appointment";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const cancelAppointment = async () => {
    if (!appointment) return;
    if (!confirm("Cancel this appointment? This cannot be undone.")) return;
    setCancelling(true);
    try {
      const { error } = await supabase.from("appointments").delete().eq("id", appointment.id);
      if (error) throw error;
      toast.success("Appointment cancelled");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to cancel appointment";
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{appointment ? "Edit Appointment" : "Book Next Appointment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="appt-title">Appointment name / type</Label>
            <Input
              id="appt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow-up, Phase 2 Check-in"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="appt-date">Date</Label>
              <Input id="appt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="appt-time">Time</Label>
              <Input id="appt-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="appt-notes">Prep notes (optional)</Label>
            <Textarea
              id="appt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to prepare for this session…"
              rows={3}
            />
          </div>
          <div className="pt-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-block">
                    <Button type="button" variant="outline" size="sm" disabled aria-disabled="true">
                      Sync to Practice Better
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Coming soon — Practice Better integration in progress.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {appointment && (
            <Button
              type="button"
              variant="destructive"
              onClick={cancelAppointment}
              disabled={cancelling || saving}
              className="mr-auto"
            >
              {cancelling ? "Cancelling…" : "Cancel Appointment"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
