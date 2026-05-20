import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Booking, type MeResponse } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { Timeline } from "../components/Timeline";
import { TakeBreakButton } from "../components/TakeBreakButton";
import { BarberSelector } from "../components/BarberSelector";
import { ShiftTimeSheet } from "../components/ShiftTimeSheet";
import { haptic } from "../lib/telegram";
import { formatDayKey } from "../lib/format";
import { useT } from "../state/Lang";

export function Dashboard({ me }: { me: MeResponse }) {
  const nav = useNavigate();
  const t = useT();
  const today = formatDayKey();
  const [date, setDate] = useState(today);

  const barbersQ = useApi(() => api.barbers(), []);
  const barbers = barbersQ.data?.barbers ?? [];
  const isAdmin = me.user.role === "ADMIN";

  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);
  const [shiftTarget, setShiftTarget] = useState<Booking | null>(null);
  const effectiveBarberId = isAdmin
    ? selectedBarberId ?? me.barber?.id ?? barbers[0]?.id ?? null
    : me.barber!.id;

  const dayQ = useApi(
    () => (effectiveBarberId ? api.dayForBarber(effectiveBarberId, date) : Promise.reject(new Error("no_barber"))),
    [effectiveBarberId, date],
  );

  const canTransfer = useMemo(
    () => barbers.filter((b) => b.id !== effectiveBarberId && b.isActive).length > 0,
    [barbers, effectiveBarberId],
  );

  const onDiscard = async (b: Booking) => {
    haptic("warning");
    try {
      await api.discard(b.id);
      haptic("success");
      void dayQ.refetch();
    } catch (err) {
      haptic("error");
      console.error(err);
    }
  };

  const onTransfer = async (b: Booking) => {
    haptic("medium");
    try {
      await api.transfer(b.id);
      haptic("success");
      void dayQ.refetch();
    } catch (err) {
      haptic("error");
      console.error(err);
    }
  };

  const bookingsCount = dayQ.data?.bookings.filter((b) => b.status === "SCHEDULED").length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-3 border-b border-line-soft bg-tg-bg px-4 pb-3 pt-4 safe-top">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-bold uppercase tracking-wider text-tg-hint">
              {me.shop.name}
            </div>
            <h1 className="truncate text-xl font-extrabold tracking-tight">
              {date === today ? t("dash.today") : date} ·{" "}
              <span className="text-tg-button">{bookingsCount}</span>{" "}
              <span className="text-sm font-bold text-tg-hint">
                {bookingsCount === 1 ? t("dash.booking") : t("dash.bookings")}
              </span>
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl bg-surface-1 px-2 py-2 text-xs font-bold ring-1 ring-line-strong"
            />
            {isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  haptic("light");
                  nav("/settings");
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 ring-1 ring-line-strong active:scale-95"
                aria-label={t("dash.settings_aria")}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        {isAdmin && barbers.length > 1 ? (
          <BarberSelector barbers={barbers} selectedId={effectiveBarberId} onSelect={setSelectedBarberId} />
        ) : null}
      </header>

      <main className="flex-1 overflow-y-auto px-3 py-4">
        {dayQ.status === "loading" ? (
          <div className="space-y-2">
            <div className="h-24 rounded-2xl shimmer" />
            <div className="h-24 rounded-2xl shimmer" />
            <div className="h-24 rounded-2xl shimmer" />
          </div>
        ) : dayQ.status === "error" || !dayQ.data ? (
          <div className="rounded-2xl bg-tg-destructive/10 px-4 py-3 text-sm text-tg-destructive ring-1 ring-tg-destructive/30">
            {t("dash.load_failed")}
          </div>
        ) : (
          <Timeline
            data={dayQ.data}
            currency={me.shop.currency}
            canTransfer={canTransfer && isAdmin}
            onDiscard={onDiscard}
            onTransfer={onTransfer}
            onShiftRequest={(b) => setShiftTarget(b)}
          />
        )}
      </main>

      <footer className="border-t border-line-soft bg-tg-bg px-4 pb-3 pt-3 safe-bottom">
        <TakeBreakButton
          barberId={isAdmin ? effectiveBarberId ?? undefined : undefined}
          onApplied={() => dayQ.refetch()}
        />
      </footer>

      <ShiftTimeSheet
        booking={shiftTarget}
        onClose={() => setShiftTarget(null)}
        onSaved={() => {
          setShiftTarget(null);
          void dayQ.refetch();
        }}
      />
    </div>
  );
}
