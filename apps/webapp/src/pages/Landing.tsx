import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type MeResponse } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { useBookingDraft } from "../state/BookingDraft";
import { BarberSelector } from "../components/BarberSelector";
import { NextSlotButton } from "../components/NextSlotButton";
import { Button } from "../components/ui/Button";
import { haptic } from "../lib/telegram";
import { useT } from "../state/Lang";

export function Landing({ me }: { me: MeResponse }) {
  const nav = useNavigate();
  const t = useT();
  const { draft, set } = useBookingDraft();

  const barbersQ = useApi(() => api.barbers(), []);
  const barbers = barbersQ.data?.barbers ?? [];

  useEffect(() => {
    if (!barbers.length || draft.barberId) return;
    const main = barbers.find((b) => b.role === "MAIN") ?? barbers[0];
    set({ barberId: main.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbers.length]);

  const selectedBarberId = draft.barberId ?? barbers[0]?.id ?? null;

  const slotParams = useMemo(
    () => ({
      barberId: selectedBarberId ?? "",
      adults: draft.adults,
      children: draft.children,
      serviceKeys: draft.optional,
    }),
    [selectedBarberId, draft.adults, draft.children, draft.optional],
  );

  const nextQ = useApi(
    () => (slotParams.barberId ? api.nextSlot(slotParams) : Promise.resolve({ slot: null, durationMin: 0 })),
    [slotParams.barberId, slotParams.adults, slotParams.children, slotParams.serviceKeys.join(",")],
  );

  const myBookingsQ = useApi(() => api.myBookings(), []);
  const upcomingCount = myBookingsQ.data?.bookings.length ?? 0;

  const slot = nextQ.data?.slot ?? null;
  const [pickCustom, setPickCustom] = useState(false);

  const goConfigure = (startAtIso: string) => {
    set({ startAt: startAtIso });
    nav("/configure");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex h-full flex-col gap-5 px-5 py-5 safe-top safe-bottom"
    >
      <header>
        <div className="eyebrow text-tg-hint">{me.shop.name}</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{t("landing.title")}</h1>
      </header>

      {upcomingCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            haptic("light");
            nav("/my-bookings");
          }}
          className="flex w-full items-center justify-between rounded-2xl bg-tg-button/12 px-4 py-3 text-left ring-1 ring-tg-button/30 transition active:scale-[0.99]"
        >
          <div>
            <div className="eyebrow text-tg-button">
              {t("landing.my_bookings")}
            </div>
            <div className="text-sm font-bold">
              {upcomingCount} {upcomingCount === 1 ? t("dash.booking") : t("dash.bookings")}
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-tg-button">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}

      <BarberSelector barbers={barbers} selectedId={selectedBarberId} onSelect={(id) => set({ barberId: id })} />

      <div className="flex-1">
        <NextSlotButton
          slotIso={slot?.startAt ?? null}
          loading={nextQ.status === "loading"}
          onClick={() => slot && goConfigure(slot.startAt)}
        />
      </div>

      <div className="space-y-2">
        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={() => {
            haptic("light");
            setPickCustom((v) => !v);
          }}
        >
          {pickCustom ? t("landing.hide_other_times") : t("landing.different_time")}
        </Button>

        {pickCustom && selectedBarberId ? (
          <DayTimePicker
            barberId={selectedBarberId}
            adults={draft.adults}
            children={draft.children}
            optional={draft.optional}
            onPick={(iso) => {
              haptic("medium");
              goConfigure(iso);
            }}
          />
        ) : null}
      </div>
    </motion.div>
  );
}

function DayTimePicker({
  barberId,
  adults,
  children,
  optional,
  onPick,
}: {
  barberId: string;
  adults: number;
  children: number;
  optional: string[];
  onPick: (iso: string) => void;
}) {
  const t = useT();
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const q = useApi(
    () => api.daySlots({ barberId, date, adults, children, serviceKeys: optional }),
    [barberId, date, adults, children, optional.join(",")],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-3 rounded-2xl bg-surface-1 p-3 ring-1 ring-line-soft"
    >
      <input
        type="date"
        value={date}
        min={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setDate(e.target.value)}
        className="w-full rounded-xl bg-tg-bg px-3 py-2.5 text-sm font-bold ring-1 ring-line-strong"
      />
      {q.status === "loading" ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 rounded-xl shimmer" />
          ))}
        </div>
      ) : (q.data?.slots ?? []).length === 0 ? (
        <div className="rounded-xl bg-tg-bg p-4 text-center text-sm text-tg-hint ring-1 ring-line-soft">
          {t("landing.no_slots_day")}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {(q.data?.slots ?? []).map((s) => (
            <motion.button
              key={s.startAt}
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => onPick(s.startAt)}
              className="rounded-xl bg-tg-bg px-2 py-2.5 text-sm font-bold tabular-nums ring-1 ring-line-strong shadow-soft active:bg-tg-button active:text-tg-buttonText"
            >
              {new Date(s.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
