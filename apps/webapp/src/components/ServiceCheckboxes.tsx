import { motion } from "framer-motion";
import type { ServiceDef } from "../lib/api";
import { haptic } from "../lib/telegram";
import { formatMoney, formatDuration } from "../lib/format";
import { useT, useLang } from "../state/Lang";
import { localizedServiceName } from "../lib/i18n";

interface Props {
  services: ServiceDef[];
  optional: string[];
  currency: string;
  onToggle: (key: string) => void;
}

const ICONS: Record<string, string> = {
  wash: "💧",
  beard: "🧔",
};

/**
 * Renders only ADDON-category services as toggleable rows. The locked haircut
 * rows + style picker chip are rendered separately in Configure.tsx so the
 * styles can drive their own bottom-sheet picker.
 */
export function ServiceCheckboxes({ services, optional, currency, onToggle }: Props) {
  const t = useT();
  const lang = useLang();
  const addons = services.filter((s) => s.category === "ADDON" && s.isActive);
  if (addons.length === 0) return null;

  return (
    <div className="space-y-2">
      {addons.map((s) => {
        const checked = optional.includes(s.key);
        return (
          <motion.button
            key={s.key}
            type="button"
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 460, damping: 22 }}
            onClick={() => {
              haptic("selection");
              onToggle(s.key);
            }}
            className={[
              "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition",
              checked
                ? "bg-tg-button/12 ring-2 ring-tg-button shadow-soft"
                : "bg-surface-1 ring-1 ring-line-strong",
            ].join(" ")}
          >
            <span className="shrink-0 text-xl">{ICONS[s.key] ?? "✨"}</span>
            <Checkbox checked={checked} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold">{localizedServiceName(lang, s.key, s.name)}</div>
              <div className="text-xs text-tg-hint">
                +{formatDuration(s.durationMin)} · {formatMoney(s.priceMinor, currency)}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition " +
        (checked ? "border-tg-button bg-tg-button text-tg-buttonText" : "border-line-strong bg-tg-bg")
      }
    >
      {checked ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}
