# PUSAN MART card reader bridge (Windows): ACR122U -> web page.
#
# The ACR122U is a PC/SC reader, which a web page cannot read. This script reads it and serves each card
# UID on this computer only:
#
#   GET http://127.0.0.1:47321/events   Server-Sent Events, one "card" event per tap: {"uid":"04002baaab5c81"}
#   GET http://127.0.0.1:47321/status   {"ok":true,"reader":"ACS ACR122 0"}
#
# The web screens (pwa/src/nfcService.js connectPcReader) listen to /events: no typing, no IME problems,
# the browser does not need focus. Chrome/Edge may ask once to allow the site to access "apps on this device":
# allow it.
#
# - UID = response of APDU FF CA 00 00 00 (card byte order), lowercase hex, same as person.uid.
# - One tap = one event. Lift the card and tap again to read it again.
# - Nothing to install: PowerShell 5.1 (built into Windows 10/11) compiles the C# below on start.
#
# Run:   start-bridge.cmd        (or: powershell -ExecutionPolicy Bypass -File acr122u-bridge.ps1)
# Test:  ... acr122u-bridge.ps1 -DryRun     (logs cards only)
#        ... acr122u-bridge.ps1 -Keyboard   (also types UID + Enter into the focused window)
param([switch]$DryRun, [switch]$Keyboard)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;

public static class PusanAcrBridge {
    // ---------- PC/SC (winscard.dll) ----------
    const int SCARD_S_SUCCESS = 0;
    const int SCARD_E_TIMEOUT = unchecked((int)0x8010000A);
    const int SCARD_SCOPE_USER = 0;
    const int SCARD_SHARE_SHARED = 2;
    const int SCARD_PROTOCOL_T0 = 1, SCARD_PROTOCOL_T1 = 2;
    const int SCARD_LEAVE_CARD = 0;
    const int SCARD_STATE_UNAWARE = 0x0, SCARD_STATE_UNKNOWN = 0x4, SCARD_STATE_UNAVAILABLE = 0x8,
              SCARD_STATE_EMPTY = 0x10, SCARD_STATE_PRESENT = 0x20;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SCARD_READERSTATE {
        public string szReader;
        public IntPtr pvUserData;
        public int dwCurrentState;
        public int dwEventState;
        public int cbAtr;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 36)] public byte[] rgbAtr;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SCARD_IO_REQUEST { public int dwProtocol; public int cbPciLength; }

    [DllImport("winscard.dll")]
    static extern int SCardEstablishContext(int dwScope, IntPtr r1, IntPtr r2, out IntPtr phContext);
    [DllImport("winscard.dll")]
    static extern int SCardReleaseContext(IntPtr hContext);
    [DllImport("winscard.dll", EntryPoint = "SCardListReadersW", CharSet = CharSet.Unicode)]
    static extern int SCardListReaders(IntPtr hContext, string mszGroups, char[] mszReaders, ref int pcchReaders);
    [DllImport("winscard.dll", EntryPoint = "SCardGetStatusChangeW", CharSet = CharSet.Unicode)]
    static extern int SCardGetStatusChange(IntPtr hContext, int dwTimeout, [In, Out] SCARD_READERSTATE[] rgReaderStates, int cReaders);
    [DllImport("winscard.dll", EntryPoint = "SCardConnectW", CharSet = CharSet.Unicode)]
    static extern int SCardConnect(IntPtr hContext, string szReader, int dwShareMode, int dwPreferredProtocols, out IntPtr phCard, out int pdwActiveProtocol);
    [DllImport("winscard.dll")]
    static extern int SCardDisconnect(IntPtr hCard, int dwDisposition);
    [DllImport("winscard.dll")]
    static extern int SCardTransmit(IntPtr hCard, ref SCARD_IO_REQUEST pioSendPci, byte[] pbSendBuffer, int cbSendLength,
                                    IntPtr pioRecvPci, byte[] pbRecvBuffer, ref int pcbRecvLength);

    // ---------- keyboard (user32 / imm32) ----------
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x2;
    const ushort VK_RETURN = 0x0D;
    const int WM_IME_CONTROL = 0x283;
    const int IMC_GETCONVERSIONMODE = 0x1, IMC_SETCONVERSIONMODE = 0x2;
    const int IME_CMODE_NATIVE = 0x1;   // set = Hangul mode

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    static extern uint MapVirtualKey(uint uCode, uint uMapType);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("imm32.dll")]
    static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);

    static void Log(string msg) { Console.WriteLine("[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + msg); }

    static INPUT Key(ushort vk, bool up) {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.u.ki.wVk = vk;
        i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        i.u.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        return i;
    }

    static void Press(ushort vk) {
        INPUT[] pair = { Key(vk, false), Key(vk, true) };
        SendInput(2, pair, Marshal.SizeOf(typeof(INPUT)));
        Thread.Sleep(5);   // web side treats keys < 60ms apart as a reader burst
    }

    static void TypeUid(string uid) {
        // Korean IME in Hangul mode would turn a-f into Hangul: switch the focused window to English, restore after.
        IntPtr ime = ImmGetDefaultIMEWnd(GetForegroundWindow());
        int mode = -1;
        if (ime != IntPtr.Zero) {
            mode = (int)SendMessage(ime, WM_IME_CONTROL, (IntPtr)IMC_GETCONVERSIONMODE, IntPtr.Zero);
            if ((mode & IME_CMODE_NATIVE) != 0) {
                SendMessage(ime, WM_IME_CONTROL, (IntPtr)IMC_SETCONVERSIONMODE, (IntPtr)(mode & ~IME_CMODE_NATIVE));
                Thread.Sleep(30);
            } else {
                mode = -1;
            }
        }
        foreach (char c in uid) {
            if (c >= '0' && c <= '9') Press((ushort)c);
            else if (c >= 'a' && c <= 'f') Press((ushort)(c - 'a' + 0x41));   // VK_A..VK_F, no Shift -> lowercase
        }
        Press(VK_RETURN);
        if (mode != -1) {
            Thread.Sleep(30);
            SendMessage(ime, WM_IME_CONTROL, (IntPtr)IMC_SETCONVERSIONMODE, (IntPtr)mode);
        }
    }

    static string ReadUid(IntPtr ctx, string reader) {
        IntPtr card; int proto;
        if (SCardConnect(ctx, reader, SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, out card, out proto) != SCARD_S_SUCCESS)
            return null;
        try {
            SCARD_IO_REQUEST pci = new SCARD_IO_REQUEST();
            pci.dwProtocol = proto;
            pci.cbPciLength = Marshal.SizeOf(typeof(SCARD_IO_REQUEST));
            byte[] cmd = { 0xFF, 0xCA, 0x00, 0x00, 0x00 };
            byte[] resp = new byte[64];
            int rlen = resp.Length;
            if (SCardTransmit(card, ref pci, cmd, cmd.Length, IntPtr.Zero, resp, ref rlen) != SCARD_S_SUCCESS) return null;
            if (rlen < 3 || resp[rlen - 2] != 0x90 || resp[rlen - 1] != 0x00) return null;
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < rlen - 2; i++) sb.Append(resp[i].ToString("x2"));
            return sb.ToString();
        } finally {
            SCardDisconnect(card, SCARD_LEAVE_CARD);
        }
    }

    static string FindReader(IntPtr ctx) {
        int len = 0;
        if (SCardListReaders(ctx, null, null, ref len) != SCARD_S_SUCCESS || len <= 1) return null;
        char[] buf = new char[len];
        if (SCardListReaders(ctx, null, buf, ref len) != SCARD_S_SUCCESS) return null;
        string[] names = new string(buf, 0, len).Split(new char[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);
        if (names.Length == 0) return null;
        foreach (string n in names) if (n.IndexOf("ACR122", StringComparison.OrdinalIgnoreCase) >= 0) return n;
        return names[0];
    }

    // ---------- HTTP / Server-Sent Events on 127.0.0.1:47321 ----------
    const int PORT = 47321;
    static readonly object Gate = new object();
    static readonly List<NetworkStream> Clients = new List<NetworkStream>();
    static string ReaderName = "";
    const string CORS = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n" +
                        "Access-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\n";

    static void Write(NetworkStream s, string text) {
        byte[] b = Encoding.UTF8.GetBytes(text);
        s.Write(b, 0, b.Length);
        s.Flush();
    }

    static void Broadcast(string msg) {
        lock (Gate) {
            for (int i = Clients.Count - 1; i >= 0; i--) {
                try { Write(Clients[i], msg); }
                catch { try { Clients[i].Close(); } catch { } Clients.RemoveAt(i); }
            }
        }
    }

    static int ClientCount() { lock (Gate) { return Clients.Count; } }

    static void HandleClient(object o) {
        TcpClient c = (TcpClient)o;
        NetworkStream s = null;
        try {
            s = c.GetStream();
            byte[] buf = new byte[4096];
            int n = s.Read(buf, 0, buf.Length);
            if (n <= 0) { c.Close(); return; }
            string req = Encoding.ASCII.GetString(buf, 0, n);
            string[] first = req.Split(new[] { "\r\n" }, StringSplitOptions.None)[0].Split(' ');
            string method = first.Length > 0 ? first[0] : "";
            string path = first.Length > 1 ? first[1].Split('?')[0] : "";
            if (method == "OPTIONS") {
                Write(s, "HTTP/1.1 204 No Content\r\n" + CORS + "Content-Length: 0\r\nConnection: close\r\n\r\n");
                c.Close();
            } else if (method == "GET" && path == "/events") {
                Write(s, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n" +
                         CORS + "\r\nretry: 2000\n\n");
                lock (Gate) { Clients.Add(s); }
                Log("Web page connected");
            } else if (method == "GET" && path == "/status") {
                string body;
                lock (Gate) { body = "{\"ok\":true,\"reader\":\"" + ReaderName.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"clients\":" + Clients.Count + "}"; }
                Write(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" + CORS + "Content-Length: " + Encoding.UTF8.GetByteCount(body) +
                         "\r\nConnection: close\r\n\r\n" + body);
                c.Close();
            } else {
                Write(s, "HTTP/1.1 404 Not Found\r\n" + CORS + "Content-Length: 0\r\nConnection: close\r\n\r\n");
                c.Close();
            }
        } catch {
            try { c.Close(); } catch { }
        }
    }

    static bool StartServer() {
        TcpListener listener = new TcpListener(IPAddress.Loopback, PORT);   // this computer only
        try { listener.Start(); } catch (SocketException) { return false; }
        Thread t = new Thread(() => {
            while (true) {
                try { ThreadPool.QueueUserWorkItem(HandleClient, listener.AcceptTcpClient()); } catch { Thread.Sleep(200); }
            }
        });
        t.IsBackground = true;
        t.Start();
        return true;
    }

    public static void Run(bool dryRun, bool keyboard) {
        if (!StartServer()) {
            Log("Port 47321 is already in use: is the bridge already running in another window?");
            return;
        }
        Log("PUSAN MART card bridge on http://127.0.0.1:47321" + (dryRun ? " (dry run: cards are only logged)" : "") +
            " - keep this window open. Waiting for the reader...");
        string lastReader = null;
        while (true) {
            IntPtr ctx;
            if (SCardEstablishContext(SCARD_SCOPE_USER, IntPtr.Zero, IntPtr.Zero, out ctx) != SCARD_S_SUCCESS) { Thread.Sleep(2000); continue; }
            try {
                string reader = FindReader(ctx);
                if (reader == null) { Thread.Sleep(2000); continue; }
                if (reader != lastReader) { Log("Reader: " + reader); lastReader = reader; }
                lock (Gate) { ReaderName = reader; }

                SCARD_READERSTATE[] st = new SCARD_READERSTATE[1];
                st[0].szReader = reader;
                st[0].dwCurrentState = SCARD_STATE_UNAWARE;
                st[0].rgbAtr = new byte[36];
                string last = null;
                int idle = 0;
                while (true) {
                    int rc = SCardGetStatusChange(ctx, 1000, st, 1);
                    if (rc == SCARD_E_TIMEOUT) {
                        if (++idle >= 15) { idle = 0; Broadcast(": ping\n\n"); }   // keeps idle connections open
                        continue;
                    }
                    if (rc != SCARD_S_SUCCESS || (st[0].dwEventState & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE)) != 0) {
                        Log("Reader lost; reconnecting...");
                        lastReader = null;
                        lock (Gate) { ReaderName = ""; }
                        break;
                    }
                    st[0].dwCurrentState = st[0].dwEventState;
                    if ((st[0].dwEventState & SCARD_STATE_PRESENT) != 0) {
                        if (last == null) {
                            string uid = ReadUid(ctx, reader);
                            if (uid != null) {
                                last = uid;
                                if (dryRun) {
                                    Log("Card " + uid + " (dry run: not sent)");
                                } else {
                                    Broadcast("event: card\ndata: {\"uid\":\"" + uid + "\"}\n\n");
                                    Log("Card " + uid + (ClientCount() > 0 ? " -> sent to the web page" : " (no web page connected: open the Office page)"));
                                    if (keyboard) TypeUid(uid);
                                }
                            }
                        }
                    } else if ((st[0].dwEventState & SCARD_STATE_EMPTY) != 0) {
                        last = null;   // card removed: the next tap types again
                    }
                }
            } finally {
                SCardReleaseContext(ctx);
            }
            Thread.Sleep(1000);
        }
    }
}
'@

[PusanAcrBridge]::Run([bool]$DryRun, [bool]$Keyboard)
