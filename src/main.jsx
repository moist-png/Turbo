import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { PricingPage } from './PublicPages.jsx'

// The legal pages are loaded on demand -- they're long documents nobody
// needs during a ride, so they live in their own files fetched only when
// someone actually opens /terms or /privacy. PricingPage stays an ordinary
// import: it shares a file with the TrboMark logo that App needs at first
// paint anyway, so there's nothing to save by splitting it.
const TermsPage = lazy(() => import('./TermsPage.jsx'))
const PrivacyPage = lazy(() => import('./PrivacyPage.jsx'))

// Lightweight path-based routing for the small set of public marketing/legal
// pages. This intentionally does not pull in a router library — App.jsx
// remains the single-page app it always was for every other route.
const path = window.location.pathname.replace(/\/+$/, '') || '/'
const ROUTES = {
  '/pricing': PricingPage,
  '/terms': TermsPage,
  '/privacy': PrivacyPage,
}
const RouteComponent = ROUTES[path]

const fallback = (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
    <style>{'@keyframes trboSpin { to { transform: rotate(360deg); } }'}</style>
    <div style={{ width: 28, height: 28, border: '3px solid rgba(47,197,174,0.25)', borderTopColor: '#2FC5AE', borderRadius: '50%', animation: 'trboSpin 0.8s linear infinite' }} aria-label="Loading" />
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={fallback}>
      {RouteComponent ? <RouteComponent /> : <App />}
    </Suspense>
  </React.StrictMode>,
)
