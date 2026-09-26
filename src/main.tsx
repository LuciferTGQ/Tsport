import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerReminderWorker } from "./reminders";
import { Capacitor } from "@capacitor/core";
if (Capacitor.isNativePlatform())
  document.documentElement.classList.add("native-app");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (
  import.meta.env.PROD &&
  !Capacitor.isNativePlatform() &&
  "serviceWorker" in navigator
) {
  window.addEventListener("load", () => {
    void registerReminderWorker().catch(() => {});
  });
}
