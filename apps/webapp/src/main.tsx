import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { BookingDraftProvider } from "./state/BookingDraft";
import { initTelegram } from "./lib/telegram";
import "./styles.css";

initTelegram();

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <BookingDraftProvider>
        <App />
      </BookingDraftProvider>
    </BrowserRouter>
  </StrictMode>,
);
