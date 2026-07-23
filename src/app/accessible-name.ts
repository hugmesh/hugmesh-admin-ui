/**
 * COPIED cross-cutting a11y micro-util (native-federation forbids a shared
 * runtime import across remotes, so each remote ships its OWN byte-identical
 * copy). Mirrors the server's {@code ScreenReaderNames} rule (hugmesh-user-
 * bff-api `web/ScreenReaderNames.java`) so the UI never passes a value the API
 * 422s and the spoken/tab name the UI shows matches what the API persists.
 */

/** Lowest printable ASCII code point (space U+0020). Below this are controls. */
const MIN_PRINTABLE_ASCII = 0x20;
/** Highest printable ASCII code point (tilde U+007E). DEL (0x7F) is excluded. */
const MAX_PRINTABLE_ASCII = 0x7e;

/**
 * Whether EVERY code point of `value` is PRINTABLE ASCII (U+0020..U+007E), matching
 * the server's `ScreenReaderNames.isAscii`. A null/empty value is treated as ASCII
 * (the absent/optional case is the caller's concern).
 *
 * **IMPORTANT**: this is the printable range, NOT the naive `/^[\x00-\x7F]*$/` 7-bit
 * range — that one would WRONGLY accept NUL, tab, newline and DEL, all of which the
 * server rejects (so the UI would pass strings the API 422s). Tab, newline and other
 * control characters make a string NON-printable-ASCII here.
 *
 * @param value - The string to test; null/undefined are treated as ASCII (pass-through).
 * @returns `true` when every code point is in U+0020..U+007E (inclusive), or when `value` is null/empty.
 */
export function isPrintableAscii(value: string | null | undefined): boolean {
  if (value == null || value.length === 0) {
    return true;
  }
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp < MIN_PRINTABLE_ASCII || cp > MAX_PRINTABLE_ASCII) {
      return false;
    }
  }
  return true;
}

/**
 * The screen-reader name to DEFAULT to for a given `displayName` — the display name
 * itself when it is pure printable-ASCII, else `null` (no safe default: a non-ASCII
 * display name needs an explicit ASCII screen-reader name, which the UI PROMPTS for).
 * Mirrors `ScreenReaderNames.defaultFor`.
 *
 * @param displayName - The user's display name (e.g. email, handle, or Unicode string).
 * @returns The display name when it is printable-ASCII, `null` when it is not or empty.
 */
export function defaultScreenReaderName(displayName: string | null | undefined): string | null {
  if (displayName == null || displayName.trim().length === 0) {
    return null;
  }
  return isPrintableAscii(displayName) ? displayName : null;
}

/**
 * The accessible (aria-label / alt / spoken / tab) name for a user. Returns the
 * ASCII `screenReaderName` when present and non-blank, else falls back to the
 * `displayName` (which may be non-ASCII — the UI shows it visually but, lacking a
 * screen-reader name, has nothing cleaner to announce). Used everywhere a user name
 * becomes an aria-label or alt text so non-ASCII display names are announced via
 * their ASCII equivalent.
 *
 * @param displayName - The user's primary display name (may contain Unicode).
 * @param screenReaderName - An explicit ASCII-only pronunciation name (may be null/blank).
 * @returns The screen-reader name when available; otherwise the display name; empty string when both absent.
 */
export function accessibleName(
  displayName: string | null | undefined,
  screenReaderName: string | null | undefined,
): string {
  if (screenReaderName != null && screenReaderName.trim().length > 0) {
    return screenReaderName;
  }
  return displayName ?? '';
}
