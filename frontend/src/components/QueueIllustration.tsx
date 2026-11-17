import { cx } from '@/lib/format'

/** A little time away from the line. Decorative, with no runtime or external assets. */
export function QueueIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 220"
      fill="none"
      aria-hidden="true"
      className={cx('queue-illustration text-ink', className)}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        className="queue-path"
        d="M22 177C65 184 76 141 116 146C163 152 158 198 211 190C259 183 254 139 303 146C339 151 364 174 398 152"
        stroke="var(--color-clay)"
        strokeWidth="2"
      />
      <g className="queue-person" stroke="currentColor" strokeWidth="1.7">
        <path d="M47 100C43 87 48 78 57 79C67 81 68 96 61 102C55 106 50 104 47 100Z" />
        <path d="M49 106L39 143L63 149L71 114M49 107C56 104 63 107 71 114L85 134L101 127M44 119L32 137L46 145M46 146L40 174L27 176M62 148L68 171L81 175" />
        <path d="M84 126L88 139L104 134L100 120Z" fill="var(--color-bg)" />
        <path d="M48 84C53 78 60 78 64 85" />
      </g>
      <g className="queue-person" stroke="currentColor" strokeWidth="1.7">
        <path d="M166 62C162 51 168 42 176 44C186 46 187 59 181 66C176 71 169 68 166 62Z" />
        <path d="M168 72C158 73 151 94 153 109L184 112L187 80L179 72M154 86L142 109L159 117M185 89L197 108L208 103M160 112L155 143L144 147M179 112L185 140L198 142" />
        <path d="M203 96L204 106L212 106L213 96ZM213 98C220 96 220 104 213 103M206 88L208 84" />
        <path d="M165 48C169 40 181 39 185 48" />
      </g>
      <g className="queue-person" stroke="currentColor" strokeWidth="1.7">
        <path d="M291 91C287 80 292 71 301 73C309 75 311 87 305 94C299 99 293 97 291 91Z" />
        <path d="M292 100C281 103 276 120 280 138L313 135L311 106L304 100M282 110L268 129L280 136M310 112L325 127L336 117M287 138L280 163L266 167M306 137L312 161L324 163" />
        <path d="M330 105L327 120L337 122L341 107Z" fill="var(--color-bg)" />
        <path d="M290 78C292 69 306 66 310 80" />
      </g>
      <g stroke="var(--color-clay)" strokeWidth="1.7">
        <path d="M352 39L354 50M371 48L363 55M370 68L360 66M339 49L345 56" />
        <path d="M105 51L106 57M102 54L109 54M242 30L243 36M239 33L246 33" />
      </g>
    </svg>
  )
}
