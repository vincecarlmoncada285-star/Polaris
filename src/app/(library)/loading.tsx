import { LoadingStatus, SkeletonBlock } from "@/components/Skeleton";

// Shown while the library loads: its heading, the search row and a few document rows.
export default function LoadingLibrary() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10" aria-busy="true" data-testid="library-skeleton">
      <LoadingStatus>Loading your documents…</LoadingStatus>
      <div className="mb-6 flex items-center justify-between gap-4">
        <SkeletonBlock className="h-9 w-56" />
        <SkeletonBlock className="h-9 w-48" />
      </div>
      <SkeletonBlock className="mb-6 h-16 w-full" />
      <SkeletonBlock className="mb-3 h-10 w-full" />
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 p-4">
            <SkeletonBlock className="h-4 w-1/3" />
            <SkeletonBlock className="h-3 w-5/6" />
            <SkeletonBlock className="h-3 w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
