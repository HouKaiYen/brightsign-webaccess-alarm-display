import type { CSSProperties, JSX } from 'react';
import type { IconKind } from '../../../shared/contracts';

interface AlarmIconProps {
  iconKind: IconKind;
  iconUrl: string;
  color: string;
  size: number;
  shouldBlink: boolean;
}

export function AlarmIcon({ iconKind, iconUrl, color, size, shouldBlink }: AlarmIconProps): JSX.Element {
  const iconStyle: CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    color,
    animation: shouldBlink ? 'settings-alarm-blink 1s steps(2, start) infinite' : undefined,
  };

  if (iconKind === 'custom' && iconUrl.length > 0) {
    return <img className="alarm-marker-icon" style={iconStyle} src={iconUrl} alt="警報圖示" draggable={false} />;
  }

  if (iconKind === 'push-button') {
    return <img className="alarm-marker-icon" style={iconStyle} src="/icons/emergency-push-button.svg" alt="緊急押鈕" draggable={false} />;
  }

  if (iconKind === 'sos') {
    return (
      <svg className="alarm-marker-icon" style={iconStyle} viewBox="0 0 100 100" role="img" aria-label="SOS">
        <circle cx="50" cy="50" r="46" fill={color} stroke="#101216" strokeWidth="6" />
        <text x="50" y="63" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="800" fill="#101216">SOS</text>
      </svg>
    );
  }

  if (iconKind === 'warning') {
    return (
      <svg className="alarm-marker-icon" style={iconStyle} viewBox="0 0 100 100" role="img" aria-label="警告">
        <path d="M50 5 97 91H3L50 5Z" fill={color} stroke="#151922" strokeWidth="5" strokeLinejoin="round" />
        <path d="M50 34v28" stroke="#151922" strokeWidth="9" strokeLinecap="round" />
        <circle cx="50" cy="76" r="5" fill="#151922" />
      </svg>
    );
  }

  return <span className="alarm-marker-icon alarm-marker-circle" style={iconStyle} aria-label="圓形警報圖示" />;
}
