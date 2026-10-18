/**
 * Grey placeholders shaped like the page that is loading. Hidden from assistive tech: the
 * status message says what is happening instead.
 */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-border/60 motion-reduce:animate-none ${className}`}
    />
  );
}

export function LoadingStatus({ children }: { children: string }) {
  return (
    <p role="status" className="sr-only">
      {children}
    </p>
  );
}
