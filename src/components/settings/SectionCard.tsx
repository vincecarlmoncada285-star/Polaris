export const primaryButton =
  "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60 aria-disabled:opacity-60 dark:text-black";

export function SectionCard({
  id,
  title,
  tone = "default",
  children,
}: {
  id: string;
  title: string;
  tone?: "default" | "danger";
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-lg border bg-surface p-6 ${
        tone === "danger" ? "border-red-300 dark:border-red-900" : "border-border"
      }`}
    >
      <h2 id={headingId} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
