import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sheet } from "./ui/Sheet";
import { Button } from "./ui/Button";
import { api, type BookingWithBarber } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { useT } from "../state/Lang";
import { formatTime, formatDuration } from "../lib/format";
import { haptic } from "../lib/telegram";

interface Props {
  booking: BookingWithBarber | null;
  onClose: () => void;
  onSaved: () => void;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Customer-side reschedule. Lists every free slot of the booking's existing
 * duration on a chosen date, lets the user tap one, and PATCH-shifts the
 * booking on the server. The booking's *own* slot may show as taken (it
 * counts in the availability query) — which is fine: picking the same slot
 * is a no-op anyway.
 */
export function ReschedulePickerSheet({ booking, onClose, onSaved }: Props) {
  const t = useT();
  const [date, setDate] = useState<string>(todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed date to the booking's own day each time a new booking is targeted.
  useEffect(() => {
    if (!booking) return;
    setDate(booking.startAt.slice(0, 10));
    setError(null);
  }, [booking?.id, booking?.startAt]);

  const slotsQ = useApi(
    () =>
      booking
        ? api.daySlotsForDuration({
            barberId: booking.barberId,
            date,
            durationMin: booking.durationMin,
          })
        : Promise.resolve({ slots: [], date, durationMin: 0 }),
    [booking?.id, booking?.barberId, date, booking?.durationMin],
  );

  const pick = async (slotIso: string) => {
    if (!booking) return;
    setError(null);
    setBusy(true);
    try {
      await api.shiftBookingTime(booking.id, slotIso);
      haptic("success");
      onSaved();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "slot_taken") setError(t("resched.err_slot_taken"));
      else if (code === "outside_hours") setError(t("resched.err_outside_hours"));
      else setError(t("resched.err_generic"));
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!booking}
      onClose={onClose}
      title={t("resched.title")}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy} fullWidth>
          {t("common.cancel")}
        </Button>
      }
    >
      {booking ? (
        <>
          <p className="mb-3 text-sm text-tg-hint">{t("resched.hint")}</p>

          <div className="mb-3 rounded-2xl bg-surface-1 p-3 ring-1 ring-line-soft">
            <div className="text-[10px] font-bold uppercase tracking-wider text-tg-hint">
              {t("resched.current")}
            </div>
            <div className="mt-0.5 flex items-baseline justify-between">
              <div className="text-2xl font-extrabold tabular-nums">{formatTime(booking.startAt)}</div>
              <div className="text-xs text-tg-hint">{formatDuration(booking.durationMin)}</div>
            </div>
          </div>

          <label className="mb-3 block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-tg-hint">
              {t("resched.pick_date")}
            </span>
            <input
              type="date"
              value={date}
              min={todayKey()}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl bg-surface-1 px-4 py-3 text-base font-bold tabular-nums ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
            />
          </label>

          {slotsQ.status === "loading" ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 rounded-xl shimmer" />
              ))}
            </div>
          ) : (slotsQ.data?.slots ?? []).length === 0 ? (
            <div className="rounded-xl bg-surface-1 p-4 text-center text-sm text-tg-hint ring-1 ring-line-soft">
              {t("resched.no_slots")}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 pb-2">
              {(slotsQ.data?.slots ?? []).map((s) => {
                const isCurrent = s.startAt === booking.startAt;
                return (
                  <motion.button
                    key={s.startAt}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    onClick={() => !busy && pick(s.startAt)}
                    disabled={busy}
                    className={
                      "rounded-xl px-2 py-2.5 text-sm font-bold tabular-nums shadow-soft active:bg-tg-button active:text-tg-buttonText " +
                      (isCurrent
                        ? "bg-tg-button/15 text-tg-button ring-2 ring-tg-button"
                        : "bg-tg-bg ring-1 ring-line-strong")
                    }
                  >
                    {formatTime(s.startAt)}
                  </motion.button>
                );
              })}
            </div>
          )}

          {busy ? (
            <div className="mt-3 text-center text-xs font-semibold text-tg-hint">{t("resched.saving")}</div>
          ) : null}
          {error ? (
            <div className="mt-3 rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm font-semibold text-tg-destructive ring-1 ring-tg-destructive/30">
              {error}
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
