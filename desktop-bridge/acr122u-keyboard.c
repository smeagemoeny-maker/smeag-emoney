/* ACR122U -> keyboard bridge (macOS).
 *
 * The ACR122U is a PC/SC reader: it does not type anything, so a web page cannot see a card tap.
 * This tool watches the reader and, for each card, types the UID (lowercase hex) + Enter into the
 * focused window, exactly like a keyboard-mode NFC reader. The PUSAN MART web screens
 * (pwa/src/nfcService.js) pick that up on every Office tab and in the mart/cafe screens.
 *
 * - UID = response of APDU FF CA 00 00 00 (card byte order), e.g. 04002baaab5c81.
 * - While typing, the input source is switched to an ASCII layout (Korean IME would turn keys into Hangul)
 *   and restored right after.
 * - Needs Accessibility permission (System Settings > Privacy & Security > Accessibility) for whatever
 *   runs it (Terminal, or this binary when started by the LaunchAgent).
 *
 * Build: clang -O2 -o acr122u-keyboard acr122u-keyboard.c -framework PCSC -framework ApplicationServices -framework Carbon
 */
#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>
#include <PCSC/winscard.h>
#include <PCSC/wintypes.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static void logf_(const char *fmt, const char *arg) {
  time_t t = time(NULL);
  char ts[32];
  strftime(ts, sizeof ts, "%Y-%m-%d %H:%M:%S", localtime(&t));
  fprintf(stderr, "[%s] ", ts);
  fprintf(stderr, fmt, arg);
  fputc('\n', stderr);
}

/* US ANSI virtual key codes for 0-9 a-f */
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
  usleep(4000); /* web side treats keys < 60ms apart as a reader burst */
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

/* Reads the UID of the card on `reader`. Returns 1 and fills `out` (lowercase hex) on success. */
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
  int dry = argc > 1 && strcmp(argv[1], "--dry-run") == 0;   /* log cards, type nothing */
  setvbuf(stderr, NULL, _IOLBF, 0);
  const void *keys[] = {kAXTrustedCheckOptionPrompt};
  const void *vals[] = {kCFBooleanTrue};
  CFDictionaryRef opts = CFDictionaryCreate(NULL, keys, vals, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  if (!dry && !AXIsProcessTrustedWithOptions(opts))
    logf_("%s", "Accessibility permission is missing: allow this program in System Settings > Privacy & Security > Accessibility, then restart it.");
  CFRelease(opts);

  logf_("%s", "ACR122U keyboard bridge started. Waiting for the reader...");
  for (;;) {
    SCARDCONTEXT ctx;
    if (SCardEstablishContext(SCARD_SCOPE_SYSTEM, NULL, NULL, &ctx) != SCARD_S_SUCCESS) { sleep(2); continue; }

    char readers[2048];
    uint32_t len = sizeof readers;
    if (SCardListReaders(ctx, NULL, readers, &len) != SCARD_S_SUCCESS || len <= 1) {
      SCardReleaseContext(ctx);
      sleep(2);
      continue;
    }
    /* first reader whose name contains ACR122, else the first reader */
    const char *reader = readers;
    for (const char *r = readers; *r; r += strlen(r) + 1)
      if (strstr(r, "ACR122")) { reader = r; break; }
    char name[256];
    snprintf(name, sizeof name, "%s", reader);
    logf_("Reader: %s", name);

    SCARD_READERSTATE st;
    memset(&st, 0, sizeof st);
    st.szReader = name;
    st.dwCurrentState = SCARD_STATE_UNAWARE;
    char last[64] = "";
    for (;;) {
      LONG rc = SCardGetStatusChange(ctx, 1000, &st, 1);
      if (rc == SCARD_E_TIMEOUT) continue;
      if (rc != SCARD_S_SUCCESS || (st.dwEventState & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE))) {
        logf_("%s", "Reader lost; reconnecting...");
        break;
      }
      st.dwCurrentState = st.dwEventState;
      if (st.dwEventState & SCARD_STATE_PRESENT) {
        char uid[64];
        if (!last[0] && read_uid(ctx, name, uid, sizeof uid)) {
          snprintf(last, sizeof last, "%s", uid);
          logf_("Card %s", uid);
          if (!dry) type_uid(uid);
        }
      } else if (st.dwEventState & SCARD_STATE_EMPTY) {
        last[0] = '\0'; /* card removed: the next tap types again */
      }
    }
    SCardReleaseContext(ctx);
    sleep(1);
  }
}
