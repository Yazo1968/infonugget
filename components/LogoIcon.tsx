interface LogoIconProps {
  size?: number;
  darkMode?: boolean;
  className?: string;
}

/** Inline SVG logo — swaps fill colors for light/dark mode. */
export default function LogoIcon({ size = 32, darkMode = false, className = '' }: LogoIconProps) {
  const outer = darkMode ? '#78AAE6' : '#262626';
  const inner = darkMode ? '#262626' : '#78AAE6';

  return (
    <svg
      viewBox="458 186 364 348"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M590.143 215.2 629.388 216.4 696.264 192 761.138 223.6 816 328 815.6 394.4 774.753 479.2 622.981 528 525.67 496.8 511.254 471.2 478.016 440.8 464 379.2 510.052 275.6 541.688 264Z"
        fill={outer}
        fillRule="evenodd"
      />
      <path
        d="M601.437 228.786 638.71 228.386 693.218 208 665.964 295.139 633.5 346.304 677.587 309.13 749.329 284.347 785 319.123 744.921 299.136 714.861 389.474 751.734 427.047 705.643 400.266 608.25 444.635 614.663 495 589.413 444.635 554.143 423.85 576.988 375.883 534.103 411.458 482 382.678 524.885 285.946 542.921 279.15 541.317 318.723 571.778 254.368Z"
        fill={inner}
        fillRule="evenodd"
      />
    </svg>
  );
}
