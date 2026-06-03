import { useEffect, useMemo, useState } from "react";
import { api, type Booking } from "../lib/api";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";
import { haptic } from "../lib/telegram";
import { formatTime } from "../lib/format";
import { useT } from "../state/Lang";

interface Props {
  booking: Booking | null;
  onClose: () => void;
  onSaved: () => void;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toHHMM(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ShiftTimeSheet({ booking, onClose, onSaved }: Props) {
  const t = useT();
  const [newTime, setNewTime] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the input when a new booking is targeted.
  useEffect(() => {
    if (booking) {
      setNewTime(toHHMM(booking.startAt));
      setError(null);
    }
  }, [booking?.id, booking?.startAt]);

  const currentLabel = useMemo(() => (booking ? formatTime(booking.startAt) : ""), [booking?.startAt]);

  const save = async () => {
    if (!booking) return;
    setError(null);
    const [h, m] = newTime.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
      setError(t("shift.err_generic"));
      return;
    }
    // Compose the new datetime on the same calendar day as the original booking.
    const orig = new Date(booking.startAt);
    const next = new Date(orig);
    next.setHours(h, m ?? 0, 0, 0);
    if (next.getTime() === orig.getTime()) {
      setError(t("shift.err_same"));
      return;
    }
    setBusy(true);
    try {
      await api.shiftBookingTime(booking.id, next.toISOString());
      haptic("success");
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "slot_taken") setError(t("shift.err_slot_taken"));
      else if (msg === "outside_hours") setError(t("shift.err_outside_hours"));
      else setError(t("shift.err_generic"));
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!booking}
      onClose={onClose}
      title={t("shift.title")}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button fullWidth onClick={save} disabled={busy}>
            {busy ? t("common.saving") : t("shift.save")}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-tg-hint">{t("shift.hint")}</p>

      <div className="space-y-3">
        <div className="rounded-2xl bg-surface-1 p-3 ring-1 ring-line-soft">
          <div className="eyebrow text-tg-hint">{t("shift.current")}</div>
          <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{currentLabel}</div>
        </div>

        <label className="block">
          <span className="mb-1 block eyebrow text-tg-hint">
            {t("shift.new_time")}
          </span>
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            className="w-full rounded-xl bg-surface-1 px-4 py-3 text-2xl font-extrabold tabular-nums ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </label>

        {error ? (
          <div className="rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm font-semibold text-tg-destructive ring-1 ring-tg-destructive/30">
            {error}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
