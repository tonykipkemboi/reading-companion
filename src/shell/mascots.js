// The companions: original characters drawn in the app's evergreen, pink and mint.
// Quippy is the finished one; Snippy and Tippy share its face so they can do everything
// it does. Each face is built from the same parts, and styles.css poses those parts for
// every mood (the [data-state] rules there):
//   .m-float       the whole body, for bobbing and hopping
//   .m-eyes        both eyes; shifts to look at things
//   .m-eye         one open eye (blinks)
//   .m-eyes-happy  smiling arcs, shown when pleased
//   .m-eyes-sleep  closed arcs, shown when dozing
//   .m-brows       eyebrows, only drawn for moods that need them
//   .m-mouth-idle / -talk / -o / -oops   one mouth per mood
//   .m-hand        Quippy's pointing hand, out while it talks
(() => {
  const INK = '#091E19';
  const PINK = '#FF7AB8';
  const BLUSH = '#F0468F';
  const MINT = '#8DE5C0';
  const GREEN = '#2FA37C';
  let serial = 0;

  const eye = (cx, cy) => `
    <g class="m-eye" style="transform-origin:${cx}px ${cy}px">
      <ellipse cx="${cx}" cy="${cy}" rx="6" ry="8.5" fill="${INK}"/>
      <circle cx="${cx + 2}" cy="${cy - 3.5}" r="2.3" fill="#fff"/>
    </g>`;

  const arcs = (className, left, right, y, bend) => `
    <g class="${className}" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round">
      <path d="M${left - 6} ${y}q6 ${bend} 12 0"/>
      <path d="M${right - 6} ${y}q6 ${bend} 12 0"/>
    </g>`;

  const face = (left, right, eyeY, mouthY, blush = BLUSH) => {
    const mid = (left + right) / 2;
    return `
    <g class="m-cheeks" fill="${blush}" fill-opacity=".5">
      <ellipse cx="${left - 9}" cy="${eyeY + 12.5}" rx="4.8" ry="3"/>
      <ellipse cx="${right + 9}" cy="${eyeY + 12.5}" rx="4.8" ry="3"/>
    </g>
    <g class="m-brows" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round">
      <path class="m-brow m-brow-l" d="M${left - 6} ${eyeY - 13.5}q5.5 -3 11 0"/>
      <path class="m-brow m-brow-r" d="M${right - 5} ${eyeY - 13.5}q5.5 -3 11 0"/>
    </g>
    <g class="m-eyes">
      ${eye(left, eyeY)}${eye(right, eyeY)}
      ${arcs('m-eyes-happy', left, right, eyeY + 2.5, -8.5)}
      ${arcs('m-eyes-sleep', left, right, eyeY, 5)}
    </g>
    <path class="m-mouth-idle" d="M${mid - 7} ${mouthY}q7 6.5 14 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse class="m-mouth-talk" cx="${mid}" cy="${mouthY + 2.5}" rx="5.5" ry="5" fill="${INK}" style="transform-origin:${mid}px ${mouthY + 2.5}px"/>
    <circle class="m-mouth-o" cx="${mid}" cy="${mouthY + 2.5}" r="3.7" fill="${INK}"/>
    <path class="m-mouth-oops" d="M${mid - 7} ${mouthY + 4}q3.5 -4.5 7 0t7 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`;
  };

  const MASCOTS = {
    quippy: {
      name: 'Quippy',
      blurb: 'A speech bubble with opinions.',
      draw: () => `
        <g class="m-hand-side">
          <path class="m-hand" d="M80 38h11a6 6 0 0 1 0 12H80z" fill="${PINK}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
        </g>
        <path d="M22 11h52a14 14 0 0 1 14 14v31a14 14 0 0 1-14 14H50L32.6 86.2a2.4 2.4 0 0 1-4.1-1.7V70H22A14 14 0 0 1 8 56V25a14 14 0 0 1 14-14z"
              fill="${PINK}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
        <path d="M15.5 31v-5.5a8 8 0 0 1 8 -8H34" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
        ${face(35, 61, 37, 53)}`,
    },
    snippy: {
      name: 'Snippy',
      blurb: 'A selection box that came to life.',
      draw: () => `
        <rect x="16" y="17" width="64" height="62" rx="15" fill="${MINT}" stroke="${INK}" stroke-width="4"/>
        <rect class="m-ants" x="24.5" y="25.5" width="47" height="45" rx="8" fill="none" stroke="${INK}" stroke-opacity=".28" stroke-width="2" stroke-dasharray="4 5.4"/>
        <g fill="${PINK}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round">
          <rect x="8.5" y="9.5" width="15" height="15" rx="4.5"/>
          <rect x="72.5" y="9.5" width="15" height="15" rx="4.5"/>
          <rect x="8.5" y="71.5" width="15" height="15" rx="4.5"/>
          <rect x="72.5" y="71.5" width="15" height="15" rx="4.5"/>
        </g>
        ${face(36, 60, 43, 58, PINK)}`,
    },
    tippy: {
      name: 'Tippy',
      blurb: 'Small, round, full of tips.',
      draw: (id) => `
        <defs>
          <linearGradient id="${id}" x1="0.85" y1="0.05" x2="0.15" y2="0.95">
            <stop offset="0" stop-color="${MINT}"/>
            <stop offset="1" stop-color="${GREEN}"/>
          </linearGradient>
        </defs>
        <path d="M48 23V12" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <circle class="m-spark" cx="48" cy="9.5" r="5.5" fill="${PINK}" stroke="${INK}" stroke-width="3.5"/>
        <circle cx="48" cy="56" r="33" fill="url(#${id})" stroke="${INK}" stroke-width="4"/>
        ${face(37, 59, 52, 67, PINK)}`,
    },
  };

  function svg(key) {
    const mascot = MASCOTS[key] || MASCOTS.quippy;
    serial += 1;
    return `<svg class="m-svg" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g class="m-float">${mascot.draw(`m-grad-${serial}`)}</g></svg>`;
  }

  window.Mascots = {
    keys: Object.keys(MASCOTS),
    get: (key) => MASCOTS[key] || MASCOTS.quippy,
    has: (key) => Boolean(MASCOTS[key]),
    svg,
  };
})();
