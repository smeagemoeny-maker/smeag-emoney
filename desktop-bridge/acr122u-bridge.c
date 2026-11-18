/* PUSAN MART card reader bridge (macOS): ACR122U -> web page.
 *
 * The ACR122U is a PC/SC reader, which a web page cannot read. This program reads it and serves each card
 * UID on this computer only:
 *
 *   GET http://127.0.0.1:47321/events   Server-Sent Events, one "card" event per tap: {"uid":"04002baaab5c81"}
 *   GET http://127.0.0.1:47321/status   {"ok":true,"reader":"ACS ACR122U PICC Interface"}
 *
 * The web screens (pwa/src/nfcService.js connectPcReader) listen to /events. No Accessibility permission,
 * no keyboard typing, no input-method problems. Chrome may ask once to allow the site to access
 * "apps on this device": allow it.
 *
 * - UID = response of APDU FF CA 00 00 00 (card byte order), lowercase hex, same as person.uid.
 * - One tap = one event. Lift the card and tap again to read it again.
 * - Options: --dry-run (log only), --keyboard (also type UID + Enter; needs Accessibility permission).
 *
 * Build: clang -O2 -o acr122u-bridge acr122u-bridge.c -framework PCSC -framework ApplicationServices -framework Carbon
 */
#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>
#include <PCSC/winscard.h>
#include <PCSC/wintypes.h>
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define PORT 47321
#define MAX_CLIENTS 32

static void logf_(const char *fmt, const char *arg) {
  time_t t = time(NULL);
  char ts[32];
  strftime(ts, sizeof ts, "%Y-%m-%d %H:%M:%S", localtime(&t));
  fprintf(stderr, "[%s] ", ts);
  fprintf(stderr, fmt, arg);
  fputc('\n', stderr);
}

/* ------------------------------------------------------------------ HTTP / SSE server */

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static int clients[MAX_CLIENTS];
static int nclients = 0;
static char reader_name[256] = "";

static const char *CORS =
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Private-Network: true\r\n"
    "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
    "Access-Control-Allow-Headers: *\r\n";

static int send_all(int fd, const char *s, size_t n) {
  while (n > 0) {
    ssize_t w = send(fd, s, n, 0);
    if (w <= 0) return -1;
    s += w;
    n -= (size_t)w;
  }
  return 0;
}

/* Drops /events clients whose page has gone away (closed tab, reload, EventSource retry).
 * Without this, dead sockets pile up while no reader is plugged in (no pings are sent then),
 * the 32 slots fill, and every new page connection is closed at once: the page reconnects
 * every 2 s and shows "Card reader connected" each time. Caller holds `lock`. */
static void prune_dead_locked(void) {
  for (int i = 0; i < nclients;) {
    char b;
    ssize_t r = recv(clients[i], &b, 1, MSG_PEEK | MSG_DONTWAIT);
    if (r == 0 || (r < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
      close(clients[i]);
      clients[i] = clients[--nclients];
    } else {
      i++;
    }
  }
}

/* Sends `msg` to every /events client; drops the ones that went away. */
static void broadcast(const char *msg) {
  pthread_mutex_lock(&lock);
  for (int i = 0; i < nclients;) {
    if (send_all(clients[i], msg, strlen(msg)) < 0) {
      close(clients[i]);
      clients[i] = clients[--nclients];
    } else {
      i++;
    }
  }
  pthread_mutex_unlock(&lock);
}

static void *handle_client(void *arg) {
  int fd = (int)(intptr_t)arg;
  char req[4096];
  ssize_t n = recv(fd, req, sizeof req - 1, 0);
  if (n <= 0) { close(fd); return NULL; }
  req[n] = '\0';
  char method[8] = "", path[256] = "";
  sscanf(req, "%7s %255s", method, path);
  char *q = strchr(path, '?');
  if (q) *q = '\0';
  char head[1024];

  if (strcmp(method, "OPTIONS") == 0) {
    snprintf(head, sizeof head, "HTTP/1.1 204 No Content\r\n%sContent-Length: 0\r\nConnection: close\r\n\r\n", CORS);
    send_all(fd, head, strlen(head));
    close(fd);
  } else if (strcmp(method, "GET") == 0 && strcmp(path, "/events") == 0) {
    snprintf(head, sizeof head,
             "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n%s\r\n"
             "retry: 2000\n\n", CORS);
    if (send_all(fd, head, strlen(head)) < 0) { close(fd); return NULL; }
    pthread_mutex_lock(&lock);
    prune_dead_locked();
    if (nclients < MAX_CLIENTS) clients[nclients++] = fd;
    else close(fd);
    pthread_mutex_unlock(&lock);
    logf_("%s", "Web page connected");
  } else if (strcmp(method, "GET") == 0 && strcmp(path, "/status") == 0) {
    char body[512];
    pthread_mutex_lock(&lock);
    snprintf(body, sizeof body, "{\"ok\":true,\"reader\":\"%s\",\"clients\":%d}", reader_name, nclients);
    pthread_mutex_unlock(&lock);
    snprintf(head, sizeof head, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n%sContent-Length: %zu\r\nConnection: close\r\n\r\n",
             CORS, strlen(body));
    send_all(fd, head, strlen(head));
    send_all(fd, body, strlen(body));
    close(fd);
  } else {
    snprintf(head, sizeof head, "HTTP/1.1 404 Not Found\r\n%sContent-Length: 0\r\nConnection: close\r\n\r\n", CORS);
    send_all(fd, head, strlen(head));
    close(fd);
  }
  return NULL;
}

static void *server_thread(void *arg) {
  int srv = (int)(intptr_t)arg;
  for (;;) {
    int fd = accept(srv, NULL, NULL);
    if (fd < 0) continue;
    pthread_t t;
    if (pthread_create(&t, NULL, handle_client, (void *)(intptr_t)fd) == 0) pthread_detach(t);
    else close(fd);
  }
  return NULL;
}

static int start_server(void) {
  int srv = socket(AF_INET, SOCK_STREAM, 0);
  int one = 1;
  setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(PORT);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);   /* this computer only */
  if (bind(srv, (struct sockaddr *)&a, sizeof a) < 0 || listen(srv, 16) < 0) return -1;
  pthread_t t;
  pthread_create(&t, NULL, server_thread, (void *)(intptr_t)srv);
  pthread_detach(t);
  return 0;
}

/* ------------------------------------------------------------------ optional keyboard typing (--keyboard) */

static CGKeyCode keycode_for(char c) {
  switch (c) {
    case '0': return kVK_ANSI_0; case '1': return kVK_ANSI_1; case '2': return kVK_ANSI_2;
    case '3': return kVK_ANSI_3; case '4': return kVK_ANSI_4; case '5': return kVK_ANSI_5;
    case '6': return kVK_ANSI_6; case '7': return kVK_ANSI_7; case '8': return kVK_ANSI_8;
    case '9': return kVK_ANSI_9; case 'a': return kVK_ANSI_A; case 'b': return kVK_ANSI_B;
    case 'c': return kVK_ANSI_C; case 'd': return kVK_ANSI_D; case 'e': return kVK_ANSI_E;
    case 'f': return kVK_ANSI_F;
  }
  return 0xFFFF;
}

static void press(CGKeyCode code, UniChar ch) {
  CGEventRef down = CGEventCreateKeyboardEvent(NULL, code, true);
  CGEventRef up = CGEventCreateKeyboardEvent(NULL, code, false);
  CGEventSetFlags(down, 0);
  CGEventSetFlags(up, 0);
  if (ch) {
    CGEventKeyboardSetUnicodeString(down, 1, &ch);
    CGEventKeyboardSetUnicodeString(up, 1, &ch);
  }
  CGEventPost(kCGHIDEventTap, down);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
  usleep(4000);
}

static void type_uid(const char *uid) {
  TISInputSourceRef current = TISCopyCurrentKeyboardInputSource();
  TISInputSourceRef ascii = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
  int switched = 0;
  if (current && ascii && !CFEqual(current, ascii)) {
    switched = TISSelectInputSource(ascii) == noErr;
    if (switched) usleep(40000);
  }
  for (const char *p = uid; *p; p++) {
    CGKeyCode code = keycode_for(*p);
    if (code != 0xFFFF) press(code, (UniChar)*p);
  }
  press(kVK_Return, '\r');
  if (switched) {
    usleep(40000);
    TISSelectInputSource(current);
  }
  if (current) CFRelease(current);
  if (ascii) CFRelease(ascii);
}

/* ------------------------------------------------------------------ PC/SC */

static int read_uid(SCARDCONTEXT ctx, const char *reader, char *out, size_t outlen) {
  SCARDHANDLE card;
  DWORD proto;
  if (SCardConnect(ctx, reader, SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, &card, &proto) != SCARD_S_SUCCESS)
    return 0;
  const SCARD_IO_REQUEST *pci = proto == SCARD_PROTOCOL_T0 ? SCARD_PCI_T0 : SCARD_PCI_T1;
  BYTE cmd[] = {0xFF, 0xCA, 0x00, 0x00, 0x00};
  BYTE resp[64];
  DWORD rlen = sizeof resp;
  int ok = 0;
  if (SCardTransmit(card, pci, cmd, sizeof cmd, NULL, resp, &rlen) == SCARD_S_SUCCESS && rlen >= 3 &&
      resp[rlen - 2] == 0x90 && resp[rlen - 1] == 0x00 && (rlen - 2) * 2 + 1 <= outlen) {
    for (DWORD i = 0; i < rlen - 2; i++) sprintf(out + i * 2, "%02x", resp[i]);
    ok = 1;
  }
  SCardDisconnect(card, SCARD_LEAVE_CARD);
  return ok;
}

int main(int argc, char **argv) {
  int dry = 0, keyboard = 0;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--dry-run") == 0) dry = 1;
    else if (strcmp(argv[i], "--keyboard") == 0) keyboard = 1;
  }
  setvbuf(stderr, NULL, _IOLBF, 0);
  signal(SIGPIPE, SIG_IGN);

  if (start_server() < 0) {
    logf_("%s", "Port 47321 is already in use: is the bridge already running in another window?");
    return 1;
  }
  if (keyboard && !dry) {
    const void *keys[] = {kAXTrustedCheckOptionPrompt};
    const void *vals[] = {kCFBooleanTrue};
    CFDictionaryRef opts = CFDictionaryCreate(NULL, keys, vals, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    if (!AXIsProcessTrustedWithOptions(opts))
      logf_("%s", "--keyboard: Accessibility permission is missing (System Settings > Privacy & Security > Accessibility).");
    CFRelease(opts);
  }
  logf_("%s", "PUSAN MART card bridge on http://127.0.0.1:47321 - keep this window open. Waiting for the reader...");

  for (;;) {
    SCARDCONTEXT ctx;
    if (SCardEstablishContext(SCARD_SCOPE_SYSTEM, NULL, NULL, &ctx) != SCARD_S_SUCCESS) { sleep(2); continue; }

    char readers[2048];
    uint32_t len = sizeof readers;
    if (SCardListReaders(ctx, NULL, readers, &len) != SCARD_S_SUCCESS || len <= 1) {
      SCardReleaseContext(ctx);
      broadcast(": ping\n\n");   /* no reader yet: still keep pages connected and drop dead ones */
      sleep(2);
      continue;
    }
    const char *reader = readers;
    for (const char *r = readers; *r; r += strlen(r) + 1)
      if (strstr(r, "ACR122")) { reader = r; break; }
    char name[256];
    snprintf(name, sizeof name, "%s", reader);
    pthread_mutex_lock(&lock);
    snprintf(reader_name, sizeof reader_name, "%s", name);
    pthread_mutex_unlock(&lock);
    logf_("Reader: %s", name);

    SCARD_READERSTATE st;
    memset(&st, 0, sizeof st);
    st.szReader = name;
    st.dwCurrentState = SCARD_STATE_UNAWARE;
    char last[64] = "";
    int idle = 0;
    for (;;) {
      LONG rc = SCardGetStatusChange(ctx, 1000, &st, 1);
      if (rc == SCARD_E_TIMEOUT) {
        if (++idle >= 15) { idle = 0; broadcast(": ping\n\n"); }   /* keeps idle connections open */
        continue;
      }
      if (rc != SCARD_S_SUCCESS || (st.dwEventState & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE))) {
        logf_("%s", "Reader lost; reconnecting...");
        pthread_mutex_lock(&lock);
        reader_name[0] = '\0';
        pthread_mutex_unlock(&lock);
        break;
      }
      st.dwCurrentState = st.dwEventState;
      if (st.dwEventState & SCARD_STATE_PRESENT) {
        char uid[64];
        /* The first read often fails while the card is still settling: retry, or the tap is lost until the card is lifted. */
        int got = 0;
        for (int tries = 0; !last[0] && !got && tries < 15; tries++) {
          if (tries) usleep(60000);
          got = read_uid(ctx, name, uid, sizeof uid);
        }
        if (!last[0] && got) {
          snprintf(last, sizeof last, "%s", uid);
          if (dry) {
            logf_("Card %s (dry run: not sent)", uid);
          } else {
            char msg[160];
            snprintf(msg, sizeof msg, "event: card\ndata: {\"uid\":\"%s\"}\n\n", uid);
            broadcast(msg);
            pthread_mutex_lock(&lock);
            int n = nclients;
            pthread_mutex_unlock(&lock);
            logf_(n ? "Card %s -> sent to the web page" : "Card %s (no web page connected: open the Office page)", uid);
            if (keyboard) type_uid(uid);
          }
        }
      } else if (st.dwEventState & SCARD_STATE_EMPTY) {
        last[0] = '\0';
      }
    }
    SCardReleaseContext(ctx);
    sleep(1);
  }
}
