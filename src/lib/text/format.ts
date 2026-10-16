// The UI is English-only, so numbers use one fixed locale. Using the runtime's default instead
// would render "1,240" on the server and "1.240" in a German browser, a hydration mismatch.
const LOCALE = "en-US";

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** Formats a count (or a value rounded to `digits` decimals) the same way on server and client. */
export function formatNumber(n: number, digits = 0): string {
  if (digits === 0) return integer.format(n);
  return n.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
