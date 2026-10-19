import type { ReactElement } from 'react';

/**
 * The social card, in the panel's dark palette. Satori does not resolve custom properties,
 * so the values from src/app/global.css are written out as literal hex.
 */
const MARK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#b5adff"><path d="M184,112a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h64A8,8,0,0,1,184,112Zm-8,24H112a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm48-88V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H72V48H48Zm160,0V48H88V208H208Z"/></svg>`,
)}`;

const INK = '#e4e9f3';
const MUTED = '#a6b1c6';
const FAINT = '#8691a6';
const PAGE = '#141923';
const RULE = '#323c50';
const LIVE = '#b5adff';

export function OgCard({
  title,
  description,
  eyebrow,
}: {
  title: string;
  description?: string;
  eyebrow: string;
}): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: PAGE,
        padding: '72px 80px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            fontSize: 22,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: FAINT,
          }}
        >
          {eyebrow}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: title.length > 42 ? 62 : 76,
            lineHeight: 1.08,
            letterSpacing: -2,
            fontWeight: 600,
            color: INK,
          }}
        >
          {title}
        </div>

        {description ? (
          <div
            style={{
              display: 'flex',
              marginTop: 26,
              maxWidth: 880,
              fontSize: 28,
              lineHeight: 1.4,
              color: MUTED,
            }}
          >
            {description.length > 150 ? `${description.slice(0, 147)}…` : description}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          borderTop: `1px solid ${RULE}`,
          paddingTop: 28,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div
          style={{ display: 'flex', padding: 9, borderRadius: 12, background: '#302d4c' }}
        >
          <img src={MARK} width={30} height={30} alt="" />
        </div>

        <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, color: INK }}>LiveSync Dashboard</div>

        <div
          style={{
            display: 'flex',
            marginLeft: 'auto',
            alignItems: 'center',
            gap: 12,
            fontSize: 22,
            color: FAINT,
          }}
        >
          <div style={{ display: 'flex', width: 9, height: 9, borderRadius: 5, background: LIVE }} />
          github.com/AlexAdiaconitei/obsidian-live-sync-dashboard
        </div>
      </div>
    </div>
  );
}
