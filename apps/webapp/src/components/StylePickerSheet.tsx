import { Sheet } from "./ui/Sheet";
import { useT } from "../state/Lang";
import { formatDuration, formatMoney } from "../lib/format";
import type { ServiceDef } from "../lib/api";
import { haptic } from "../lib/telegram";

interface Props {
  open: boolean;
  styles: ServiceDef[];
  selectedKey: string | null;
  /** What to render as title — "adult" or "child" picker context. */
  context: "adult" | "child";
  currency: string;
  onPick: (key: string | null) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet picker for haircut styles. Each row = one HAIRCUT_ADULT or
 * HAIRCUT_CHILD service; the row marked isDefault is shown with a "default" pill.
 * Tapping a row selects it and closes the sheet. The selection bubbles up to
 * BookingDraft so the live quote re-computes immediately.
 */
export function StylePickerSheet({ open, styles, selectedKey, context, currency, onPick, onClose }: Props) {
  const t = useT();
  const sorted = [...styles].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });

  // The "effectively selected" key: explicit pick wins, otherwise the default.
  const effective = selectedKey ?? sorted.find((s) => s.isDefault)?.key ?? sorted[0]?.key ?? null;

  const pick = (key: string | null) => {
    haptic("selection");
    onPick(key);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(context === "adult" ? "style.picker_title_adult" : "style.picker_title_child")}
    >
      <div className="space-y-2 pb-4">
        {sorted.map((s) => {
          const isSelected = s.key === effective;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s.isDefault ? null : s.key)}
              className={[
                "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition active:scale-[0.98]",
                isSelected
                  ? "bg-tg-button/12 ring-2 ring-tg-button shadow-soft"
                  : "bg-surface-1 ring-1 ring-line-strong",
              ].join(" ")}
            >
              <Radio checked={isSelected} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-base font-bold">{s.name}</div>
                  {s.isDefault ? (
                    <span className="shrink-0 rounded-full bg-tg-hint/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-tg-hint">
                      {t("style.default_label")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-tg-hint">
                  {formatDuration(s.durationMin)} · {formatMoney(s.priceMinor, currency)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      className={
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 " +
        (checked ? "border-tg-button bg-tg-button" : "border-line-strong bg-tg-bg")
      }
    >
      {checked ? <span className="h-2.5 w-2.5 rounded-full bg-tg-buttonText" /> : null}
    </span>
  );
}
