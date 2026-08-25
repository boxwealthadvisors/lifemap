import React from 'react'
import { Link } from 'react-router-dom'

export function LifemapMark() {
  return <span className="lm-mark" />
}

export function LifemapBrand({ to }) {
  const inner = (
    <>
      <LifemapMark />
      <span>
        <span className="lm-brand-name">LifeMap</span>
        <span className="lm-brand-by">by BOX Wealth</span>
      </span>
    </>
  )
  if (to) return <Link className="lm-brand" to={to}>{inner}</Link>
  return <span className="lm-brand">{inner}</span>
}

export function LifemapFooter() {
  return (
    <footer className="lm-footer">
      <div className="lm-tier">
        <span className="lm-brand">
          <LifemapMark />
          <span className="lm-brand-name">LifeMap</span>
        </span>
        <span className="lm-footer-tag">Invest with Intent.</span>
        <span style={{ marginLeft: 'auto' }}>
          <a href="#">Terms</a>
          {' · '}
          <a href="#">Privacy</a>
        </span>
      </div>
      <div className="lm-disclaimer">
        LifeMap is an educational planning tool from BOX Wealth Advisors. Figures shown are illustrations based on the assumptions you enter, not a forecast or a recommendation.
      </div>
    </footer>
  )
}

export function LifemapAdminShell({ title, kicker, actions, children }) {
  return (
    <div className="lm-shell">
      <header className="lm-topbar">
        <div className="lm-tier lm-tier0">
          <LifemapBrand to="/" />
          <span className="lm-acts">{actions}</span>
        </div>
        <div className="lm-tier" style={{ paddingBottom: 14 }}>
          <div className="lm-phead" style={{ margin: '8px 0 0' }}>
            {kicker ? <div className="lm-eyebrow" style={{ color: 'var(--lm-navy)' }}>{kicker}</div> : null}
            <h1>{title}</h1>
          </div>
        </div>
      </header>
      <main className="lm-body" style={{ paddingTop: 18 }}>{children}</main>
      <LifemapFooter />
    </div>
  )
}

export function LifemapGate({ title, subtitle, children }) {
  return (
    <div className="lm-gate">
      <div className="lm-gate-card">
        <div className="lm-gate-brand">
          <LifemapMark />
          <span>
            <span className="lm-brand-name">LifeMap</span>
            <span className="lm-brand-by">by BOX Wealth</span>
          </span>
        </div>
        <h1>{title}</h1>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
        {children}
        <p className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
          <Link to="/">Back to LifeMap</Link>
        </p>
      </div>
    </div>
  )
}
