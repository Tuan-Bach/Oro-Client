const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("oroNative", {
  isElectron: true,
  selectWorkspaceFolder: () => ipcRenderer.invoke("oro:selectWorkspaceFolder"),
  windowControl: (action) => ipcRenderer.invoke("oro:windowControl", action),
  revealInExplorer: (path) => ipcRenderer.invoke("oro:revealInExplorer", path),
  setZoomFactor: (factor) => {
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
