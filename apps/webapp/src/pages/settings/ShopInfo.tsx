import { useEffect, useState } from "react";
import { api, type MeResponse } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { haptic } from "../../lib/telegram";
import { useT } from "../../state/Lang";

export function ShopInfoPage({ me }: { me: MeResponse }) {
  const t = useT();
  const [location, setLocation] = useState<string>(me.shop.location ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the "Saved ✓" indicator after a couple seconds.
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);

  const dirty = (me.shop.location ?? "") !== location;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.adminUpdateSettings({ location: location.trim() ? location.trim() : null });
      haptic("success");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("shop.title")} subtitle={t("shop.sub")} />

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft">
          <label className="block">
            <span className="mb-1 block eyebrow text-tg-hint">
              {t("shop.location_label")}
            </span>
            <textarea
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("shop.location_placeholder")}
              rows={3}
              maxLength={300}
              className="w-full resize-none rounded-xl bg-tg-bg px-4 py-3 text-base ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
            />
          </label>
          <p className="mt-2 text-xs text-tg-hint">{t("shop.location_hint")}</p>

          <div className="mt-3 flex items-center justify-end gap-3">
            {saved ? (
              <span className="text-xs font-bold text-success">{t("shop.location_saved")}</span>
            ) : null}
            <Button size="sm" onClick={save} disabled={!dirty || busy}>
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </div>

          {error ? (
            <div className="mt-3 rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm font-semibold text-tg-destructive ring-1 ring-tg-destructive/30">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
