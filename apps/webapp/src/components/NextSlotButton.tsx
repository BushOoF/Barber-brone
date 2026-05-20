import { motion } from "framer-motion";
import { formatTime } from "../lib/format";
import { haptic } from "../lib/telegram";
import { useT } from "../state/Lang";

interface Props {
  slotIso: string | null;
  loading: boolean;
  onClick: () => void;
}

export function NextSlotButton({ slotIso, loading, onClick }: Props) {
  const t = useT();
  const disabled = loading || !slotIso;
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 360, damping: 24 }}
      onClick={() => {
        if (disabled) return;
        haptic("medium");
        onClick();
      }}
      className={[
        "relative w-full overflow-hidden rounded-[28px] px-6 py-7 text-left text-tg-buttonText",
        "bg-gradient-to-br from-tg-button to-tg-link shadow-pop ring-1 ring-black/5",
        "disabled:opacity-60 disabled:shadow-none",
      ].join(" ")}
    >
      <div className="absolute inset-0 opacity-30">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
        <div className="absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      </div>
      <div className="relative">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-90">{t("landing.next_kicker")}</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-5xl font-extrabold tabular-nums leading-none">
            {loading ? "…" : slotIso ? formatTime(slotIso) : "—"}
          </span>
        </div>
        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider">
          {loading ? t("landing.finding_slot") : slotIso ? `${t("landing.tap_to_book")} →` : t("landing.no_slot")}
        </div>
      </div>
    </motion.button>
  );
}
