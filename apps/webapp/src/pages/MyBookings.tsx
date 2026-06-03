import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type BookingWithBarber, type MeResponse } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { ReschedulePickerSheet } from "../components/ReschedulePickerSheet";
import { useT, useLang } from "../state/Lang";
import { localizedServiceName } from "../lib/i18n";
import { formatDuration, formatMoney, formatTime } from "../lib/format";
import { haptic } from "../lib/telegram";

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function formatDayLabel(iso: string, t: ReturnType<typeof useT>): string {
  if (isToday(iso)) return t("mybook.section_today");
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}

export function MyBookings({ me }: { me: MeResponse }) {
  const t = useT();
  const lang = useLang();
  const nav = useNavigate();
  const list = useApi(() => api.myBookings(), []);
  const [reschedTarget, setReschedTarget] = useState<BookingWithBarber | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const bookings = list.data?.bookings ?? [];

  const { today, upcoming } = useMemo(() => {
    const today: BookingWithBarber[] = [];
    const upcoming: BookingWithBarber[] = [];
    for (const b of bookings) (isToday(b.startAt) ? today : upcoming).push(b);
    return { today, upcoming };
  }, [bookings]);

  const onCancel = async (b: BookingWithBarber) => {
    if (!confirm(t("mybook.cancel_confirm", { time: formatTime(b.startAt) }))) return;
    setCancellingId(b.id);
    try {
      await api.cancelMyBooking(b.id);
      haptic("success");
      await list.refetch();
    } catch {
      haptic("error");
      alert(t("mybook.cancel_failed"));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("mybook.title")} subtitle={t("mybook.subtitle")} onBack={() => nav("/")} />

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6">
        {list.status === "loading" ? (
          <div className="space-y-2">
            <div className="h-28 rounded-2xl shimmer" />
            <div className="h-28 rounded-2xl shimmer" />
          </div>
        ) : bookings.length === 0 ? (
          <EmptyState me={me} onGo={() => nav("/")} />
        ) : (
          <>
            {today.length > 0 ? (
              <Section title={t("mybook.section_today")}>
                {today.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    currency={me.shop.currency}
                    lang={lang}
                    cancelling={cancellingId === b.id}
                    onReschedule={() => setReschedTarget(b)}
                    onCancel={() => onCancel(b)}
                  />
                ))}
              </Section>
            ) : null}
            {upcoming.length > 0 ? (
              <Section title={t("mybook.section_upcoming")}>
                {upcoming.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    currency={me.shop.currency}
                    lang={lang}
                    cancelling={cancellingId === b.id}
                    onReschedule={() => setReschedTarget(b)}
                    onCancel={() => onCancel(b)}
                    dayLabel={formatDayLabel(b.startAt, t)}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </div>

      <ReschedulePickerSheet
        booking={reschedTarget}
        onClose={() => setReschedTarget(null)}
        onSaved={async () => {
          setReschedTarget(null);
          await list.refetch();
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="eyebrow text-tg-hint">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function BookingRow({
  booking,
  currency,
  lang,
  cancelling,
  onReschedule,
  onCancel,
  dayLabel,
}: {
  booking: BookingWithBarber;
  currency: string;
  lang: "UZ" | "RU" | "EN";
  cancelling: boolean;
  onReschedule: () => void;
  onCancel: () => void;
  dayLabel?: string;
}) {
  const t = useT();
  const extras = booking.services.filter((k) => k !== "haircut_adult" && k !== "haircut_child");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {dayLabel ? (
            <div className="eyebrow text-tg-hint">{dayLabel}</div>
          ) : null}
          <div className="text-2xl font-extrabold tabular-nums leading-tight">
            {formatTime(booking.startAt)}
          </div>
          <div className="mt-0.5 text-xs text-tg-hint">
            {t("mybook.with_barber")}: <span className="font-bold text-tg-text">{booking.barber.displayName}</span>
            {" · "}
            {formatDuration(booking.durationMin)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold tabular-nums">{formatMoney(booking.totalPriceMinor, currency)}</div>
          <div className="text-[11px] text-tg-hint">
            {booking.adults > 0 ? `${booking.adults} ${booking.adults === 1 ? t("common.adult") : t("common.adults_plural")}` : ""}
            {booking.children > 0 ? ` · ${booking.children} ${booking.children === 1 ? t("common.child") : t("common.children_plural")}` : ""}
          </div>
        </div>
      </div>

      {extras.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {extras.map((k) => (
            <span
              key={k}
              className="rounded-full bg-tg-bg px-2 py-0.5 text-[10px] font-semibold text-tg-hint ring-1 ring-line-strong"
            >
              {localizedServiceName(lang, k, k)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onReschedule} disabled={cancelling}>
          {t("mybook.reschedule")}
        </Button>
        <Button size="sm" variant="destructive" onClick={onCancel} disabled={cancelling}>
          {cancelling ? "…" : t("mybook.cancel")}
        </Button>
      </div>
    </motion.div>
  );
}

function EmptyState({ me, onGo }: { me: MeResponse; onGo: () => void }) {
  const t = useT();
  return (
    <div className="mt-8 rounded-3xl bg-surface-1 p-8 text-center ring-1 ring-line-soft">
      <div className="text-5xl">📭</div>
      <h2 className="mt-3 text-lg font-bold">{t("mybook.empty_title")}</h2>
      <p className="mt-1 text-sm text-tg-hint">{t("mybook.empty_sub")}</p>
      <div className="mt-4 inline-flex">
        <Button onClick={onGo}>{t("mybook.empty_cta")}</Button>
      </div>
      <div className="mt-4 text-[10px] text-tg-hint">{me.shop.name}</div>
    </div>
  );
}
