import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { haptic } from "../../lib/telegram";
import { useT } from "../../state/Lang";

const MAX_PHOTO_MB = 10;

export function AnnouncementsPage() {
  const t = useT();
  const history = useApi(() => api.adminListAnnouncements(), []);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ delivered: number; recipients: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build/dispose object URL for the preview thumbnail.
  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const charLimit = photo ? 1024 : 2000;
  const overLimit = message.length > charLimit;

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    if (f.size > MAX_PHOTO_MB * 1024 * 1024) {
      setError(t("ann.photo_too_large"));
      e.target.value = "";
      return;
    }
    setPhoto(f);
    e.target.value = ""; // allow re-picking the same file later
  };

  const removePhoto = () => {
    setPhoto(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const send = async () => {
    setError(null);
    const trimmed = message.trim();
    // With a photo the caption is optional; pure text needs *some* content.
    if (!photo && !trimmed) {
      setError(t("ann.empty_message"));
      return;
    }
    if (trimmed.length > charLimit) {
      setError(photo ? t("ann.caption_too_long") : t("ann.empty_message"));
      return;
    }
    if (!confirm(t("ann.confirm", { n: "?" }))) return;
    setBusy(true);
    try {
      const r = await api.adminSendAnnouncement(trimmed, photo);
      haptic("success");
      setLastResult(r.announcement);
      setMessage("");
      removePhoto();
      history.refetch();
    } catch (err) {
      const m = err instanceof Error ? err.message : "Failed";
      if (m === "caption_too_long") setError(t("ann.caption_too_long"));
      else if (m === "bad_photo_type") setError(t("ann.photo_too_large"));
      else setError(m);
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("ann.title")} subtitle={t("ann.sub")} />

      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-6">
        <div className="rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft">
          {/* Photo preview */}
          {photo && previewUrl ? (
            <div className="relative mb-3 overflow-hidden rounded-xl bg-tg-bg ring-1 ring-line-strong">
              <img src={previewUrl} alt={photo.name} className="max-h-64 w-full object-contain" />
              <button
                type="button"
                onClick={removePhoto}
                aria-label={t("ann.remove_photo")}
                className="absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-sm active:scale-95"
              >
                ✕ {t("ann.remove_photo")}
              </button>
              <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                {photo.name} · {(photo.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
          ) : null}

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={photo ? t("ann.compose_placeholder_with_photo") : t("ann.compose_placeholder")}
            rows={photo ? 3 : 5}
            maxLength={charLimit}
            className={
              "w-full resize-none rounded-xl bg-tg-bg px-4 py-3 text-base ring-1 focus:outline-none focus:ring-2 " +
              (overLimit ? "ring-tg-destructive focus:ring-tg-destructive" : "ring-line-strong focus:ring-tg-button")
            }
          />
          <div className={"mt-1 text-right text-[10px] tabular-nums " + (overLimit ? "text-tg-destructive" : "text-tg-hint")}>
            {message.length} / {charLimit}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={onPickPhoto}
                className="hidden"
              />
              <Button
                size="sm"
                variant={photo ? "secondary" : "ghost"}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("ann.attach_photo")}
              </Button>
              {lastResult ? (
                <div className="text-xs font-semibold text-emerald-600">
                  {t("ann.sent_summary", { delivered: lastResult.delivered, recipients: lastResult.recipients })}
                </div>
              ) : null}
            </div>
            <Button
              size="lg"
              onClick={send}
              disabled={busy || overLimit || (!photo && message.trim().length === 0)}
            >
              {busy ? t("ann.sending") : `📢 ${t("ann.send")}`}
            </Button>
          </div>
          {error ? (
            <div className="mt-3 rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm text-tg-destructive ring-1 ring-tg-destructive/30">
              {error}
            </div>
          ) : null}
        </div>

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-tg-hint">{t("ann.history_title")}</h2>
          {history.status === "loading" ? (
            <div className="space-y-2">
              <div className="h-20 rounded-xl shimmer" />
              <div className="h-20 rounded-xl shimmer" />
            </div>
          ) : (history.data?.announcements ?? []).length === 0 ? (
            <div className="rounded-2xl bg-surface-1 p-6 text-center text-sm text-tg-hint ring-1 ring-line-soft">
              {t("ann.history_empty")}
            </div>
          ) : (
            <div className="space-y-2">
              {(history.data?.announcements ?? []).map((a) => (
                <div key={a.id} className="rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft">
                  {a.photoFileId ? (
                    <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-tg-button/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-tg-button">
                      <span>📷</span>
                      <span>{t("ann.has_photo")}</span>
                      {a.photoName ? <span className="opacity-70 normal-case">· {a.photoName}</span> : null}
                    </div>
                  ) : null}
                  {a.message ? (
                    <div className="whitespace-pre-wrap text-sm">{a.message}</div>
                  ) : (
                    <div className="text-sm italic text-tg-hint">—</div>
                  )}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-tg-hint">
                    <span>{new Date(a.createdAt).toLocaleString()}</span>
                    <span>
                      <span className="font-bold text-emerald-600">{a.delivered}</span> {t("ann.stat_delivered")}
                      {a.failed > 0 ? (
                        <>
                          {" · "}
                          <span className="font-bold text-tg-destructive">{a.failed}</span> {t("ann.stat_failed")}
                        </>
                      ) : null}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
