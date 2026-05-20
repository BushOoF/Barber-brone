import { Routes, Route, Navigate } from "react-router-dom";
import { useApi } from "./hooks/useApi";
import { api } from "./lib/api";
import { Landing } from "./pages/Landing";
import { Configure } from "./pages/Configure";
import { Confirmation } from "./pages/Confirmation";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { ApprenticesPage } from "./pages/settings/Apprentices";
import { ServicesPage } from "./pages/settings/Services";
import { ClientsPage } from "./pages/settings/Clients";
import { FinancesPage } from "./pages/settings/Finances";
import { LangProvider } from "./state/Lang";
import { DEFAULT_LANG, translate, type Lang } from "./lib/i18n";

export function App() {
  const { data, status, error } = useApi(() => api.me(), []);

  if (status === "loading" || status === "idle") {
    return <LoadingScreen />;
  }
  if (status === "error" || !data) {
    return <ErrorScreen error={error} lang={DEFAULT_LANG} />;
  }

  const lang = (data.user.language as Lang) ?? DEFAULT_LANG;
  const isStaff = data.user.role !== "CUSTOMER" && data.barber !== null;
  const isAdmin = data.user.role === "ADMIN";
  const hasPhone = !!data.user.phone;

  return (
    <LangProvider lang={lang}>
      <Routes>
        <Route
          path="/"
          element={
            !hasPhone ? <NeedPhoneScreen lang={lang} /> : isStaff ? <Navigate to="/dashboard" replace /> : <Landing me={data} />
          }
        />
        <Route path="/configure" element={hasPhone ? <Configure me={data} /> : <Navigate to="/" replace />} />
        <Route path="/confirmation/:id" element={<Confirmation me={data} />} />
        <Route path="/dashboard" element={isStaff ? <Dashboard me={data} /> : <Navigate to="/" replace />} />

        {/* Admin-only Settings tree */}
        <Route path="/settings" element={isAdmin ? <Settings me={data} /> : <Navigate to="/dashboard" replace />} />
        <Route
          path="/settings/apprentices"
          element={isAdmin ? <ApprenticesPage me={data} /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/settings/services"
          element={isAdmin ? <ServicesPage me={data} /> : <Navigate to="/dashboard" replace />}
        />
        <Route path="/settings/clients" element={isAdmin ? <ClientsPage /> : <Navigate to="/dashboard" replace />} />
        <Route
          path="/settings/finances"
          element={isAdmin ? <FinancesPage me={data} /> : <Navigate to="/dashboard" replace />}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LangProvider>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-line-soft border-t-tg-button" />
        <div className="text-sm font-medium text-tg-hint">{translate(DEFAULT_LANG, "common.loading")}</div>
      </div>
    </div>
  );
}

function ErrorScreen({ error, lang }: { error: Error | null; lang: Lang }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-5xl">🛠️</div>
      <h1 className="text-xl font-bold">{translate(lang, "auth.load_failed_title")}</h1>
      <p className="max-w-xs text-sm text-tg-hint">{error?.message ?? "Unknown error"}</p>
      <p className="text-xs text-tg-hint">{translate(lang, "auth.load_failed_hint")}</p>
    </div>
  );
}

function NeedPhoneScreen({ lang }: { lang: Lang }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-6xl">📱</div>
      <h1 className="text-2xl font-bold tracking-tight">{translate(lang, "auth.phone_title")}</h1>
      <p className="max-w-xs text-sm text-tg-hint">{translate(lang, "auth.phone_hint")}</p>
      <p className="text-xs text-tg-hint">
        <span className="font-semibold text-tg-text">{translate(lang, "auth.share_phone_strong")}</span>
      </p>
    </div>
  );
}
