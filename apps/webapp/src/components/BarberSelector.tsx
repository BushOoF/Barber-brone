import type { Barber } from "../lib/api";
import { haptic } from "../lib/telegram";
import { useT } from "../state/Lang";

interface Props {
  barbers: Barber[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function BarberSelector({ barbers, selectedId, onSelect }: Props) {
  const t = useT();
  if (barbers.length === 0) return null;
  if (barbers.length === 1) {
    return (
      <div className="rounded-2xl bg-surface-1 px-4 py-3 ring-1 ring-line-soft">
        <div className="text-[10px] font-bold uppercase tracking-wider text-tg-hint">{t("landing.barber")}</div>
        <div className="mt-0.5 text-base font-bold">{barbers[0].displayName}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 rounded-2xl bg-surface-1 p-1.5 ring-1 ring-line-soft">
      {barbers.map((b) => {
        const active = b.id === selectedId;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => {
              haptic("selection");
              onSelect(b.id);
            }}
            className={
              "flex-1 rounded-xl px-3 py-2 text-sm transition active:scale-[0.98] " +
              (active
                ? "bg-tg-bg shadow-soft ring-1 ring-line-strong text-tg-text"
                : "text-tg-hint")
            }
          >
            <div className="font-bold leading-tight">{b.displayName}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
              {b.role === "MAIN" ? t("landing.main_barber") : t("landing.apprentice")}
            </div>
          </button>
        );
      })}
    </div>
  );
}
