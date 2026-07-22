import React from 'react';

// ---------------------------------------------------------------------------
// Trbo public pages: /pricing, /terms, /privacy
//
// These are deliberately separate from App.jsx's internal theme system (which
// uses Oswald/Inter and CSS custom properties for dark/light mode). The brand
// sheet (Trbo_Brand_Sheet_v2.svg) specifies a distinct, locked identity for
// outward-facing marketing surfaces: Big Shoulders Display for headers,
// Manrope for body copy, Space Grotesk for numerals. Fonts are loaded via
// Google Fonts <link> tags injected in index.html.
//
// This page is a true informational placeholder: pricing is DISPLAYED, not
// SOLD. There is no working checkout or account-creation CTA here — see
// TRBO_MINIMAL_PAGE_HANDOVER.md Section 1 and 5 for why.
// ---------------------------------------------------------------------------

const COLOR = {
  ink: '#14171A',
  cream: '#F3EDE3',
  panel: '#FFFFFF',
  teal: '#2FC5AE',
  mint: '#C0F5ED',
  tan: '#E6CBA8',
  muted: '#8B7F6E',
  hairline: '#E3D9C8',
};

const FONT_HEAD = "'Big Shoulders Display', sans-serif";
const FONT_BODY = "'Manrope', sans-serif";
const FONT_NUM = "'Space Grotesk', sans-serif";

export function TrboMark({ size = 44 }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.22, background: COLOR.ink,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}
    >
      <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 58 64" fill="none">
        <path d="M10 22 L20 32 L10 42" stroke={COLOR.tan} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 18 L34 32 L20 46" stroke={COLOR.mint} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 14 L48 32 L32 50" stroke={COLOR.teal} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function PublicHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px', maxWidth: 1000, margin: '0 auto' }}>
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
        <TrboMark size={40} />
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 26, letterSpacing: -0.5, color: COLOR.ink }}>TRBO</span>
      </a>
      <div style={{ flex: 1 }} />
      <a href="/" style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: COLOR.ink, textDecoration: 'none', padding: '9px 16px', borderRadius: 8, border: `1px solid ${COLOR.hairline}` }}>Log in</a>
    </div>
  );
}

export function PublicFooter() {
  return (
    <div style={{ borderTop: `1px solid ${COLOR.hairline}`, marginTop: 60 }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 24px', display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLOR.muted, lineHeight: 1.6 }}>
          Trbo<br />301/19-21 Wilson St, Botany NSW 2019
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <a href="/pricing" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLOR.muted, textDecoration: 'none' }}>Pricing</a>
          <a href="/terms" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLOR.muted, textDecoration: 'none' }}>Terms</a>
          <a href="/privacy" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLOR.muted, textDecoration: 'none' }}>Privacy</a>
          <a href="mailto:Trbo.help@outlook.com" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLOR.muted, textDecoration: 'none' }}>Trbo.help@outlook.com</a>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ title, desc }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '18px 0', borderBottom: `1px solid ${COLOR.hairline}` }}>
      <div style={{ width: 8, height: 8, borderRadius: 999, background: COLOR.teal, marginTop: 7, flexShrink: 0 }} />
      <div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15.5, color: COLOR.ink }}>{title}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLOR.muted, marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

function PriceCard({ label, price, sub, note, highlight }) {
  return (
    <div style={{
      flex: '1 1 240px', background: highlight ? COLOR.ink : COLOR.panel, border: `1px solid ${highlight ? COLOR.ink : COLOR.hairline}`,
      borderRadius: 18, padding: 26,
    }}>
      <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: highlight ? COLOR.mint : COLOR.muted, marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: FONT_NUM, fontWeight: 600, fontSize: 40, color: highlight ? '#FFFFFF' : COLOR.ink }}>{price}</span>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: highlight ? '#B9C2C6' : COLOR.muted, marginTop: 4 }}>{sub}</div>
      {note && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: highlight ? COLOR.mint : COLOR.teal, marginTop: 10, fontWeight: 700 }}>{note}</div>}
    </div>
  );
}

export function PricingPage() {
  return (
    <div style={{ background: COLOR.cream, minHeight: '100vh', fontFamily: FONT_BODY }}>
      <PublicHeader />

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px 20px' }}>
        <div style={{ maxWidth: 640 }}>
          <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 'clamp(38px, 6vw, 62px)', lineHeight: 0.98, letterSpacing: -1, color: COLOR.ink, margin: '0 0 18px', textTransform: 'uppercase' }}>
            Smart trainer.<br />Smarter training.
          </h1>
          <p style={{ fontFamily: FONT_BODY, fontSize: 17, lineHeight: 1.6, color: '#3A3530', margin: 0 }}>
            Structured indoor cycling training with real smart trainer connectivity: ERG mode control, a large workout library, an AI-driven plan builder, and mini-games.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 24px 0' }}>
        <FeatureRow title="ERG mode trainer control via Bluetooth" desc="Connect a smart trainer directly in the browser or the native app and let Trbo hold your target power for you, interval by interval." />
        <FeatureRow title="Structured, periodized workout library" desc="A large library of purpose-built sessions spanning endurance, threshold, VO2, and anaerobic work." />
        <FeatureRow title="AI-driven training plan builder" desc="Tell Trbo your goal, your available days, and your hours per week — it builds a periodized plan and rotates workouts so sessions don't repeat too often." />
        <FeatureRow title="Mini-games" desc="Short, game-ified rides that make hard efforts more fun without losing structure." />
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 24px 0' }}>
        <h2 style={{ fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 28, color: COLOR.ink, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: -0.5 }}>Pricing</h2>
        <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLOR.muted, margin: '0 0 20px' }}>Simple, single-tier pricing. Cancel anytime.</p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <PriceCard label="Monthly" price="US$8.99" sub="per month" />
          <PriceCard label="Annual" price="US$89.99" sub="per year" note="10 months paid upfront, 2 months free" highlight />
        </div>

        <div style={{ marginTop: 22, background: COLOR.panel, border: `1px solid ${COLOR.hairline}`, borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: COLOR.ink, marginBottom: 4 }}>New signups aren't open yet</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLOR.muted, lineHeight: 1.55 }}>
            Trbo is between launches right now, so we're not creating new accounts at the moment — the prices above reflect what a subscription will cost once signups reopen. Already have an account? <a href="/" style={{ color: COLOR.teal, fontWeight: 700, textDecoration: 'none' }}>Log in here</a>.
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 24px 0' }}>
        <h2 style={{ fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 28, color: COLOR.ink, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: -0.5 }}>Contact</h2>
        <p style={{ fontFamily: FONT_BODY, fontSize: 14.5, color: '#3A3530', margin: 0 }}>
          Questions, support, or press: <a href="mailto:Trbo.help@outlook.com" style={{ color: COLOR.teal, fontWeight: 700, textDecoration: 'none' }}>Trbo.help@outlook.com</a>
        </p>
      </div>

      <PublicFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared legal-document shell
// ---------------------------------------------------------------------------

function LegalShell({ title, updated, children }) {
  return (
    <div style={{ background: COLOR.cream, minHeight: '100vh', fontFamily: FONT_BODY }}>
      <PublicHeader />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 24px 60px' }}>
        <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 40, color: COLOR.ink, margin: '10px 0 4px', textTransform: 'uppercase', letterSpacing: -1 }}>{title}</h1>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: COLOR.muted, marginBottom: 32 }}>Last updated {updated}</div>
        <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.hairline}`, borderRadius: 16, padding: '32px 34px' }}>
          {children}
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}

export function LegalH2({ children }) {
  return <h2 style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 17, color: COLOR.ink, margin: '30px 0 10px' }}>{children}</h2>;
}
export function LegalH3({ children }) {
  return <h3 style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14.5, color: COLOR.ink, margin: '18px 0 6px' }}>{children}</h3>;
}
export function LegalP({ children }) {
  return <p style={{ fontFamily: FONT_BODY, fontSize: 14, lineHeight: 1.7, color: '#3A3530', margin: '0 0 12px' }}>{children}</p>;
}
export function LegalLi({ children }) {
  return <li style={{ fontFamily: FONT_BODY, fontSize: 14, lineHeight: 1.7, color: '#3A3530', marginBottom: 6 }}>{children}</li>;
}
export function LegalUl({ children }) {
  return <ul style={{ margin: '0 0 12px', paddingLeft: 22 }}>{children}</ul>;
}
export function LegalTable({ headers, rows }) {
  return (
    <div style={{ overflowX: 'auto', margin: '10px 0 16px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT_BODY, fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: `2px solid ${COLOR.hairline}`, color: COLOR.ink, fontWeight: 800 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: '8px 10px', borderBottom: `1px solid ${COLOR.hairline}`, color: '#3A3530', verticalAlign: 'top' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { LegalShell, COLOR as PUBLIC_COLOR, FONT_HEAD, FONT_BODY, FONT_NUM };
