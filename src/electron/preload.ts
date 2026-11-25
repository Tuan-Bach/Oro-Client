import { contextBridge, ipcRenderer, webFrame } from "electron";

contextBridge.exposeInMainWorld("oroNative", {
  isElectron: true,
  selectWorkspaceFolder: () => ipcRenderer.invoke("oro:selectWorkspaceFolder"),
  windowControl: (action: "minimize" | "maximize" | "close") => ipcRenderer.invoke("oro:windowControl", action),
  setZoomFactor: (factor: number) => {
    try {
      if (typeof factor === "number" && !isNaN(factor) && factor > 0) {
        webFrame.setZoomFactor(factor);
      }
    } catch (err) {
      console.error("Failed to set zoom factor:", err);
    }
  },
  getZoomFactor: () => {
    try {
      return webFrame.getZoomFactor();
    } catch {
      return 1;
    }
  },
});
