/**
 * Envoi d'octets bruts (RAW) à une imprimante Windows, sans pilote graphique : sert à la commande
 * d'ouverture du tiroir-caisse (ESC/POS) via le spouleur. Le script PowerShell est passé encodé
 * (-EncodedCommand) ; le nom de l'imprimante et le fichier de données passent par l'environnement,
 * jamais collés dans le script (aucune injection possible).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RAW_PRINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PsRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("Imprimante introuvable : " + printer + " (code " + Marshal.GetLastWin32Error() + ")");
    try {
      DocInfo di = new DocInfo(); di.pDocName = "PharmaStock tiroir-caisse"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter (code " + Marshal.GetLastWin32Error() + ")");
      try {
        StartPagePrinter(h);
        IntPtr p = Marshal.AllocCoTaskMem(data.Length);
        try { Marshal.Copy(data, 0, p, data.Length); int w; WritePrinter(h, p, data.Length, out w); }
        finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
$printer = $env:PS_PRINTER
if (-not $printer) { $printer = (Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name }
if (-not $printer) { throw "Aucune imprimante par défaut." }
[PsRawPrinter]::Send($printer, [IO.File]::ReadAllBytes($env:PS_DATA_FILE))
`;

/** Encodage attendu par `powershell -EncodedCommand` (UTF-16 little-endian en base64). */
export const encodePowerShell = (script: string) =>
  Buffer.from(script, 'utf16le').toString('base64');

/** Envoie `data` à l'imprimante nommée (ou à l'imprimante par défaut si le nom est vide). */
export async function sendRaw(printer: string, data: Buffer): Promise<void> {
  if (process.platform !== 'win32')
    throw new Error('L’ouverture du tiroir-caisse n’est disponible que sous Windows.');
  const file = join(tmpdir(), `pharmastock-raw-${randomBytes(6).toString('hex')}.bin`);
  await writeFile(file, data);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodePowerShell(RAW_PRINT_SCRIPT),
        ],
        {
          env: { ...process.env, PS_PRINTER: printer, PS_DATA_FILE: file },
          windowsHide: true,
          timeout: 15_000,
        },
        (error, _stdout, stderr) =>
          error ? reject(new Error(stderr.trim() || error.message)) : resolve(),
      );
    });
  } finally {
    await rm(file, { force: true });
  }
}
