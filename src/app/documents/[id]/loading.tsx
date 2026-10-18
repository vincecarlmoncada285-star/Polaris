import { LoadingStatus, SkeletonBlock } from "@/components/Skeleton";

// Shown while a document loads: the toolbar, the page with its title and text, and the panel.
export default function LoadingDocument() {
  return (
    <div
      className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      aria-busy="true"
      data-testid="document-skeleton"
    >
      <LoadingStatus>Opening the document…</LoadingStatus>
      <div className="min-w-0">
        <SkeletonBlock className="h-10 w-full" />
        <div className="mt-4 space-y-4 rounded-lg border border-border bg-surface px-6 py-8 sm:px-12 sm:py-12">
          <SkeletonBlock className="h-8 w-2/3" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-11/12" />
          <SkeletonBlock className="h-4 w-4/5" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-3/5" />
        </div>
      </div>
      <div className="space-y-3">
        <SkeletonBlock className="h-9 w-full" />
        <SkeletonBlock className="h-20 w-full" />
        <SkeletonBlock className="h-20 w-full" />
      </div>
    </div>
  );
}
