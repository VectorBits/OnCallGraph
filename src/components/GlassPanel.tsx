import type { PropsWithChildren } from 'react'

export function GlassPanel({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={[
        'h-full w-full rounded-2xl border border-white/12 bg-white/[0.06] backdrop-blur-xl',
        'shadow-[0_14px_50px_rgba(0,0,0,0.5)]',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
