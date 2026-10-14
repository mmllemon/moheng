/** Ink-and-balance brand mark built entirely from SVG paths. */
export default function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true">
    <svg viewBox="0 0 40 40" role="img" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 14.5 20 5.5l13 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 15.5v18h20v-18M15 33.5V22h10v11.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5.5 34.5h29M20 9.5v7m-5-1h10m-9 1.5-4 5.5h8l-4-5.5Zm8 0-4 5.5h8l-4-5.5Z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="16.5" r="1.6" fill="currentColor" />
    </svg>
  </span>;
}
