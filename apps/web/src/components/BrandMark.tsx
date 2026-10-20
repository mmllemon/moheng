/** Ink seal brand mark: a carved 墨 in a rough vermilion frame. */
export default function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true">
    <svg viewBox="0 0 48 48" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="mhSealRough" x="-14%" y="-14%" width="128%" height="128%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="1.5" fill="#a23a2a" filter="url(#mhSealRough)" />
      <rect x="5.5" y="5.5" width="37" height="37" fill="none" stroke="#f8ecda" strokeWidth="1" opacity=".55" />
      <text x="24" y="32" textAnchor="middle" fontFamily="'MH Serif SC',serif" fontSize="23" fontWeight="600" fill="#f8ecda">墨</text>
    </svg>
  </span>;
}
