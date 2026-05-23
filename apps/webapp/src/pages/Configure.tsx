import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type MeResponse, type ServiceDef } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { useBookingDraft } from "../state/BookingDraft";
import { PartyStepper } from "../components/PartyStepper";
import { ServiceCheckboxes } from "../components/ServiceCheckboxes";
import { StylePickerSheet } from "../components/StylePickerSheet";
import { Button } from "../components/ui/Button";
import {
  clientQuote,
  effectiveAdultStyle,
  effectiveChildStyle,
  serviceKeysFromSelection,
} from "../lib/pricing";
import { haptic } from "../lib/telegram";
import { formatMoney, formatDuration, formatTime } from "../lib/format";
import { useT, useLang } from "../state/Lang";
import { localizedServiceName } from "../lib/i18n";

export function Configure({ me }: { me: MeResponse }) {
  const nav = useNavigate();
  const t = useT();
  const lang = useLang();
  const { draft, set } = useBookingDraft();
  const servicesQ = useApi(() => api.services(), []);
  const services = servicesQ.data?.services ?? [];
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stylePicker, setStylePicker] = useState<"adult" | "child" | null>(null);

  const adultStyles = useMemo(() => services.filter((s) => s.category === "HAIRCUT_ADULT" && s.isActive), [services]);
  const childStyles = useMemo(() => services.filter((s) => s.category === "HAIRCUT_CHILD" && s.isActive), [services]);

  const adultPicked = effectiveAdultStyle(services, draft.selectedAdultStyleKey);
  const childPicked = effectiveChildStyle(services, draft.selectedChildStyleKey);

  const quote = useMemo(
    () => clientQuote(services, {
      adults: draft.adults,
      children: draft.children,
      optional: draft.optional,
      selectedAdultStyleKey: draft.selectedAdultStyleKey,
      selectedChildStyleKey: draft.selectedChildStyleKey,
    }),
    [services, draft.adults, draft.children, draft.optional, draft.selectedAdultStyleKey, draft.selectedChildStyleKey],
  );

  if (!draft.startAt || !draft.barberId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-4xl">🤔</div>
        <p className="text-sm text-tg-hint">{t("configure.missing_slot")}</p>
        <Button onClick={() => nav("/")}>{t("configure.start_over")}</Button>
      </div>
    );
  }

  const toggleOptional = (key: string) => {
    set({
      optional: draft.optional.includes(key) ? draft.optional.filter((k) => k !== key) : [...draft.optional, key],
    });
  };

  const onCancel = () => nav("/");

  const onBook = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createBooking({
        barberId: draft.barberId!,
        startAt: draft.startAt!,
        adults: draft.adults,
        children: draft.children,
        services: serviceKeysFromSelection({
          adults: draft.adults,
          children: draft.children,
          optional: draft.optional,
        }),
        selectedAdultStyleKey: draft.selectedAdultStyleKey,
        selectedChildStyleKey: draft.selectedChildStyleKey,
        remindersOn: draft.remindersOn,
      });
      haptic("success");
      nav(`/confirmation/${result.booking.id}`, { state: { booking: result.booking } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Booking failed";
      const userMessage =
        message === "slot_taken"
          ? t("configure.err_slot_taken")
          : message === "phone_required"
          ? t("configure.err_phone")
          : t("configure.err_generic");
      setError(userMessage);
      haptic("error");
    } finally {
      setSubmitting(false);
    }
  };

  const peopleCount = draft.adults + draft.children;
  const canBook = peopleCount > 0 && quote.durationMin > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex h-full flex-col"
    >
      <header className="px-5 pb-2 pt-4 safe-top">
        <button onClick={onCancel} className="-ml-1 inline-flex items-center text-sm font-semibold text-tg-hint">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mr-1">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("configure.back")}
        </button>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{t("configure.title")}</h1>
        <div className="mt-0.5 text-sm text-tg-hint">
          {t("configure.slot")} <span className="font-bold text-tg-text tabular-nums">{formatTime(draft.startAt)}</span>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <motion.div
          key={`${quote.totalPriceMinor}-${quote.durationMin}`}
          initial={{ scale: 0.97 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 340, damping: 22 }}
          className="rounded-3xl bg-gradient-to-br from-tg-button to-tg-link p-5 text-tg-buttonText shadow-pop"
        >
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-85">{t("configure.estimated_total")}</div>
          <div className="mt-1 flex items-baseline justify-between">
            <div className="text-3xl font-extrabold tabular-nums">{formatMoney(quote.totalPriceMinor, me.shop.currency)}</div>
            <div className="text-sm font-bold opacity-90">{formatDuration(quote.durationMin)}</div>
          </div>
          <div className="mt-1 text-[11px] opacity-80">{t("configure.final_note")}</div>
        </motion.div>

        <section className="space-y-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-tg-hint">{t("configure.services_section")}</h2>

          {/* Locked haircut row(s) + inline style picker chip */}
          {draft.adults > 0 && adultPicked ? (
            <LockedHaircutRow
              icon="💈"
              style={adultPicked}
              currency={me.shop.currency}
              subtitle={t("configure.required_per_adult")}
              localizedName={localizedServiceName(lang, adultPicked.key, adultPicked.name)}
              extraStyles={adultStyles.length}
              onOpenPicker={() => adultStyles.length > 1 && setStylePicker("adult")}
            />
          ) : null}
          {draft.children > 0 && childPicked ? (
            <LockedHaircutRow
              icon="🧒"
              style={childPicked}
              currency={me.shop.currency}
              subtitle={t("configure.required_per_child")}
              localizedName={localizedServiceName(lang, childPicked.key, childPicked.name)}
              extraStyles={childStyles.length}
              onOpenPicker={() => childStyles.length > 1 && setStylePicker("child")}
            />
          ) : null}

          <ServiceCheckboxes
            services={services}
            optional={draft.optional}
            currency={me.shop.currency}
            onToggle={toggleOptional}
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-tg-hint">{t("configure.party_section")}</h2>
          <PartyStepper label={t("common.adults_label")} icon="🧔" value={draft.adults} min={0} onChange={(v) => set({ adults: v })} />
          <PartyStepper label={t("common.children_label")} icon="🧒" value={draft.children} min={0} onChange={(v) => set({ children: v })} />
          {peopleCount === 0 ? (
            <div className="rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm font-semibold text-tg-destructive ring-1 ring-tg-destructive/30">
              {t("configure.at_least_one")}
            </div>
          ) : null}
        </section>

        {error ? (
          <div className="rounded-xl bg-tg-destructive/10 px-4 py-3 text-sm font-semibold text-tg-destructive ring-1 ring-tg-destructive/30">
            {error}
          </div>
        ) : null}
      </div>

      <footer className="flex items-center gap-3 border-t border-line-soft bg-tg-bg px-5 py-3 safe-bottom">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button size="xl" className="flex-1" onClick={onBook} disabled={submitting || !canBook}>
          {submitting ? t("configure.booking") : t("configure.book")}
        </Button>
      </footer>

      <StylePickerSheet
        open={stylePicker === "adult"}
        styles={adultStyles}
        selectedKey={draft.selectedAdultStyleKey}
        context="adult"
        currency={me.shop.currency}
        onPick={(key) => set({ selectedAdultStyleKey: key })}
        onClose={() => setStylePicker(null)}
      />
      <StylePickerSheet
        open={stylePicker === "child"}
        styles={childStyles}
        selectedKey={draft.selectedChildStyleKey}
        context="child"
        currency={me.shop.currency}
        onPick={(key) => set({ selectedChildStyleKey: key })}
        onClose={() => setStylePicker(null)}
      />
    </motion.div>
  );
}

function LockedHaircutRow({
  icon,
  style,
  currency,
  subtitle,
  localizedName,
  extraStyles,
  onOpenPicker,
}: {
  icon: string;
  style: ServiceDef;
  currency: string;
  subtitle: string;
  localizedName: string;
  /** How many active styles exist in this category. Picker chip only shown if >1. */
  extraStyles: number;
  onOpenPicker: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 rounded-2xl bg-tg-button/12 px-4 py-3 ring-2 ring-tg-button shadow-soft">
        <span className="shrink-0 text-xl">{icon}</span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-tg-button text-tg-buttonText">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M6 10V8a6 6 0 1112 0v2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="4" y="10" width="16" height="11" rx="2" fill="currentColor" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{localizedName}</div>
          <div className="text-xs text-tg-hint">
            {subtitle} · {formatDuration(style.durationMin)} · {formatMoney(style.priceMinor, currency)}
          </div>
        </div>
      </div>

      {extraStyles > 1 ? (
        <button
          type="button"
          onClick={onOpenPicker}
          className="ml-9 inline-flex items-center gap-1.5 rounded-full bg-surface-1 px-3 py-1.5 text-xs font-bold text-tg-text ring-1 ring-line-strong active:scale-95"
        >
          <span>✂️</span>
          <span>{t("style.choose")}: {localizedName}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
