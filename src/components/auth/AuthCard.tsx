/** What Polaris is, for someone arriving at the sign-in or sign-up page. */
export const POLARIS_DESCRIPTION =
  "Polaris is an open-source writing companion for academic writing. It underlines issues as you write and explains each one, so you learn the conventions instead of just accepting fixes.";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="font-serif text-3xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">{children}</div>
      <p className="mt-4 text-center text-sm text-muted">{footer}</p>
      <p
        className="mt-8 border-t border-border pt-4 text-sm text-muted"
        data-testid="about-polaris"
      >
        {POLARIS_DESCRIPTION}
      </p>
    </div>
  );
}
