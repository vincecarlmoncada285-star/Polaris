/** Where Polaris's source and its privacy notes live. On every page, and never printed. */
export const SOURCE_URL = "https://github.com/vincecarlmoncada285-star/Polaris";
export const PRIVACY_URL = `${SOURCE_URL}#privacy`;

const linkClass = "underline underline-offset-2 hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t border-border" data-print="hide">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-muted">
        <a href={SOURCE_URL} className={linkClass}>
          Polaris is open source
        </a>
        <a href={PRIVACY_URL} className={linkClass}>
          Privacy
        </a>
      </div>
    </footer>
  );
}
