import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import type { OroElectronApi } from "../ipc-types.js";
import { createOroApiClient } from "./api.js";

declare global {
  interface Window {
    oro: OroElectronApi;
  }
}

// Initialize Oro API client if not already provided
if (!window.oro) {
  window.oro = createOroApiClient();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
