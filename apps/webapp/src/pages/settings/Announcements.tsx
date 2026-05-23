import { useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { haptic } from "../../lib/telegram";
import { useT } from "../../state/Lang";

export function AnnouncementsPage() {
  const t = useT();
  const history = useApi(() => api.adminListAnnouncements(), []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ delivered: number; recipients: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    const trimmed = message.trim();
    if (!trimmed) {
      setError(t("ann.empty_message"));
      return;
    }
    // Quick confirmation — we don't know the count up-front without an extra fetch.
    if (!confirm(t("ann.confirm", { n: "?" }))) return;
    setBusy(true);
    try {
      const r = await api.adminSendAnnouncement(trimmed);
      haptic("success");
      setLastResult(r.announcement);
      setMessage("");
      history.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
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
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("ann.compose_placeholder")}
            rows={5}
            maxLength={2000}
            className="w-full resize-none rounded-xl bg-tg-bg px-4 py-3 text-base ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
          <div className="mt-1 text-right text-[10px] text-tg-hint tabular-nums">{message.length} / 2000</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            {lastResult ? (
              <div className="text-xs font-semibold text-emerald-600">
                {t("ann.sent_summary", { delivered: lastResult.delivered, recipients: lastResult.recipients })}
              </div>
            ) : <span />}
            <Button size="lg" onClick={send} disabled={busy || message.trim().length === 0}>
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
                  <div className="whitespace-pre-wrap text-sm">{a.message}</div>
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
