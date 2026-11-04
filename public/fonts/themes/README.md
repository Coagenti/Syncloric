# Theme fonts

Unmodified, self-hosted WOFF2 assets downloaded from Google Fonts on 2026-11-04.
Latin and Latin Extended subsets cover the Italian/English interface.

- Cyberpunk: Chakra Petch 500/700 and Barlow 400/500/700.
- Synthwave: Orbitron 500/700 and Space Grotesk 400/500/700.
- Terminal: IBM Plex Mono 400/500/700.

The 24 font files total 380,412 bytes; only the active theme's used faces load.
Original URLs, sizes and SHA-256 hashes are in `sources.json`.
Each family includes its original `OFL-*.txt` license. Sources:

- https://github.com/google/fonts/tree/main/ofl/chakrapetch
- https://github.com/google/fonts/tree/main/ofl/barlow
- https://github.com/google/fonts/tree/main/ofl/orbitron
- https://github.com/google/fonts/tree/main/ofl/spacegrotesk
- https://github.com/google/fonts/tree/main/ofl/ibmplexmono

`src/app/theme-fonts.css` references these ordinary public assets; no external
font service is contacted at runtime. Other scripts use the system fallback.
