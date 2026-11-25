using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace OroLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                string appDir = @"C:\Users\BACH\.gemini\antigravity\scratch\oro";

                if (File.Exists(Path.Combine(exeDir, @"node_modules\electron\dist\electron.exe")))
                {
                    appDir = exeDir;
                }

                string electronExe = Path.Combine(appDir, @"node_modules\electron\dist\electron.exe");
                string mainScript = Path.Combine(appDir, @"dist\electron\main.js");
                string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";

                // 1. Launch Electron desktop app
                if (File.Exists(electronExe) && File.Exists(mainScript))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = electronExe;
                    psi.Arguments = "\"" + mainScript + "\"";
                    if (args.Length > 0)
                    {
                        psi.Arguments += " \"" + args[0] + "\"";
                    }
                    psi.WorkingDirectory = appDir;
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                    return;
                }

                // 2. Fallback: Edge App Mode (Chromium borderless native window)
                string nodeExe = @"C:\Program Files\nodejs\node.exe";
                if (!File.Exists(nodeExe)) nodeExe = "node";
                string serverScript = Path.Combine(appDir, @"dist\server\run-server.js");

                ProcessStartInfo serverPsi = new ProcessStartInfo(nodeExe, "\"" + serverScript + "\" 5824");
                serverPsi.WorkingDirectory = appDir;
                serverPsi.UseShellExecute = false;
                serverPsi.CreateNoWindow = true;
                Process.Start(serverPsi);

                if (File.Exists(edgePath))
                {
                    ProcessStartInfo edgePsi = new ProcessStartInfo(edgePath, "--app=http://127.0.0.1:5824 --window-size=1440,920");
                    edgePsi.UseShellExecute = false;
                    Process.Start(edgePsi);
                }
                else
                {
                    Process.Start("http://127.0.0.1:5824");
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not launch Oro: " + ex.Message, "Oro Launcher Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
