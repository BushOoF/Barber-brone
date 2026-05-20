import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type Booking, type MeResponse } from "../lib/api";
import { useBookingDraft } from "../state/BookingDraft";
import { Button } from "../components/ui/Button";
import { getTg, haptic } from "../lib/telegram";
import { formatDuration, formatMoney, formatTime } from "../lib/format";
import { useT, useLang } from "../state/Lang";
import { localizedServiceName } from "../lib/i18n";

interface LocationState {
  booking?: Booking;
}

export function Confirmation({ me }: { me: MeResponse }) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const nav = useNavigate();
  const t = useT();
  const lang = useLang();
  const { reset } = useBookingDraft();

  const initial = (location.state as LocationState | null)?.booking ?? null;
  const [booking, setBooking] = useState<Booking | null>(initial);
  const [remindersOn, setRemindersOn] = useState<boolean>(initial?.remindersOn ?? true);

  useEffect(() => {
    if (booking || !id) return;
    void api.myBookings().then((r) => {
      const found = r.bookings.find((b) => b.id === id);
      if (found) {
        setBooking(found);
        setRemindersOn(found.remindersOn);
      }
    });
  }, [id, booking]);

  const toggleReminders = async () => {
    if (!booking) return;
    const next = !remindersOn;
    setRemindersOn(next);
    haptic("selection");
    try {
      await api.toggleReminders(booking.id, next);
    } catch {
      setRemindersOn(!next);
    }
  };

  const close = () => {
    haptic("light");
    reset();
    const tg = getTg();
    if (tg) tg.close();
    else nav("/");
  };

  if (!booking) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-tg-hint">{t("common.loading")}</div>
      </div>
    );
  }

  const extras = booking.services.filter((k) => k !== "haircut_adult" && k !== "haircut_child");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex h-full flex-col safe-top safe-bottom"
    >
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6 text-center">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.05 }}
          className="mx-auto mt-4 flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/15 text-5xl ring-4 ring-emerald-500/30"
        >
          ✅
        </motion.div>

        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t("confirm.title")}</h1>
          <p className="mt-1 text-sm text-tg-hint">{t("confirm.subtitle")}</p>
        </div>

        <div className="rounded-3xl bg-surface-1 p-5 text-left ring-1 ring-line-soft">
          <Row label={t("confirm.time")} value={formatTime(booking.startAt)} strong />
          <Divider />
          <Row label={t("confirm.duration")} value={formatDuration(booking.durationMin)} />
          <Divider />
          <Row label={t("common.adults_label")} value={String(booking.adults)} />
          {booking.children > 0 ? (
            <>
              <Divider />
              <Row label={t("common.children_label")} value={String(booking.children)} />
            </>
          ) : null}
          {extras.length > 0 ? (
            <>
              <Divider />
              <Row label={t("confirm.extras")} value={extras.map((k) => localizedServiceName(lang, k, k)).join(", ")} />
            </>
          ) : null}
          <Divider />
          <Row
            label={t("confirm.total")}
            value={formatMoney(booking.totalPriceMinor, me.shop.currency)}
            strong
            highlight
          />
          {me.shop.location ? (
            <>
              <Divider />
              <LocationRow label={t("confirm.location")} value={me.shop.location} />
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggleReminders}
          className={
            "w-full rounded-2xl px-4 py-3 text-sm font-bold transition ring-1 " +
            (remindersOn
              ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30"
              : "bg-tg-destructive/10 text-tg-destructive ring-tg-destructive/30")
          }
        >
          {remindersOn ? t("confirm.reminder_on") : t("confirm.reminder_off")}
        </button>
      </div>

      <footer className="border-t border-line-soft bg-tg-bg px-5 pt-3 safe-bottom">
        <Button size="xl" fullWidth onClick={close} hapticOnPress={false}>
          {t("confirm.close")}
        </Button>
      </footer>
    </motion.div>
  );
}

function Row({ label, value, strong, highlight }: { label: string; value: string; strong?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-tg-hint">{label}</span>
      <span
        className={[
          highlight ? "text-xl font-extrabold text-tg-button" : strong ? "text-lg font-bold" : "font-semibold",
          "tabular-nums",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-0.5 h-px bg-line-soft" />;
}

function LocationRow({ label, value }: { label: string; value: string }) {
  // Open the address in Google/Apple Maps when tapped.
  const mapHref = `https://maps.google.com/?q=${encodeURIComponent(value)}`;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-tg-hint">{label}</span>
      <a
        href={mapHref}
        target="_blank"
        rel="noreferrer"
        className="text-right text-sm font-semibold text-tg-link underline-offset-2 hover:underline"
      >
        📍 {value}
      </a>
    </div>
  );
}
