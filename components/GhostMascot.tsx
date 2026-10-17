export default function GhostMascot({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={`ghost-mascot ${small ? "small" : ""}`}
      viewBox="0 0 140 150"
      fill="none"
      aria-label="Boo, your ghost mechanic"
      role="img"
    >
      <ellipse cx="70" cy="136" rx="34" ry="7" fill="#121020" opacity=".55" />
      <path
        d="M28 112V66C28 9 112 9 112 66V112L97 103L84 116L70 105L55 116L42 105L28 112Z"
        fill="#e9e3ff"
        stroke="#aaa0d0"
        strokeWidth="3"
      />
      <path
        d="M34 73C44 52 94 47 107 70"
        stroke="white"
        strokeWidth="7"
        opacity=".35"
      />
      <rect x="46" y="65" width="12" height="19" rx="5" fill="#2b2344" />
      <rect x="82" y="65" width="12" height="19" rx="5" fill="#2b2344" />
      <path
        d="M65 89Q70 94 75 89"
        stroke="#2b2344"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse cx="43" cy="87" rx="9" ry="4" fill="#bba1eb" />
      <ellipse cx="97" cy="87" rx="9" ry="4" fill="#bba1eb" />
      <path
        d="M25 102L14 90L20 83L32 96M107 96L123 79"
        stroke="#b6f7a6"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path d="M120 68L118 79L129 84L138 76L131 74L127 68Z" fill="#b6f7a6" />
      <path d="M31 47L42 33H99L109 47Z" fill="#a7ef92" />
      <path d="M53 32L57 20H84L88 32" fill="#a7ef92" />
      <rect x="65" y="23" width="11" height="12" rx="2" fill="#4b6d47" />
    </svg>
  );
}
