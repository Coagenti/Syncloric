/** A small displacement gives neon strokes actual ripples during the glitch burst. */
export function EnergyRippleFilter({ id }: { id: string }) {
  return <svg className="energy-effects" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    <filter id={id} x="-15%" y="-50%" width="130%" height="200%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.014 0.09" numOctaves="2" seed="8" result="ripples" />
      <feDisplacementMap in="SourceGraphic" in2="ripples" scale="9" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </defs></svg>;
}
