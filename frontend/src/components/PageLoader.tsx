export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted">
      <span
        aria-hidden
        className="size-7 animate-spin rounded-full border-2 border-line-strong border-t-brand"
      />
      <p className="text-sm">{label}</p>
    </div>
  )
}
