import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Moon, Sun, UserCircle, TrendingUp } from 'lucide-react'
import FloatingChartDock, { ChartToggleButton } from './FloatingChartDock'
import { useChart } from '../contexts/ChartContext'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from 'next-themes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

const navigationItems = [
  { path: '/', value: 'dashboard', label: 'FP Calculator', tone: '#003c8f' },
  { path: '/assets', value: 'assets', label: 'Assets', tone: '#2f6fd0' },
  { path: '/work-assets', value: 'work-assets', label: 'Work Assets', tone: '#0d8a78' },
  { path: '/goals', value: 'goals', label: 'Goals', tone: '#e9a23b' },
  { path: '/loans', value: 'loans', label: 'Loans', tone: '#e2574c' },
  { path: '/expenses', value: 'expenses', label: 'Expenses', tone: '#8494ad' },
  { path: '/insurance', value: 'insurance', label: 'Insurance', tone: '#4fb9ab' },
]

const PAGE_SECTIONS = {
  '/': [
    { id: 'top', label: 'Freedom chart' },
    { id: 'inputs', label: 'Your details' },
    { id: 'today', label: 'Where you stand today' },
    { id: 'register', label: 'The next layer' },
  ],
  '/assets': [
    { id: 'sec-mix', label: 'Asset mix' },
    { id: 'sec-growth', label: 'Growth over time' },
    { id: 'sec-register', label: 'Asset register' },
  ],
  '/work-assets': [
    { id: 'sec-mix', label: 'Income mix' },
    { id: 'sec-growth', label: 'Income over time' },
    { id: 'sec-register', label: 'Work asset register' },
  ],
  '/goals': [
    { id: 'sec-mix', label: 'What it adds up to' },
    { id: 'sec-when', label: 'When the money is needed' },
    { id: 'sec-register', label: 'Goal register' },
  ],
  '/loans': [
    { id: 'sec-mix', label: 'What you owe' },
    { id: 'sec-schedule', label: 'Path to debt-free' },
    { id: 'sec-register', label: 'Current loans' },
  ],
  '/expenses': [
    { id: 'sec-mix', label: 'Expense mix' },
    { id: 'sec-rule', label: 'Needs / wants / savings' },
    { id: 'sec-growth', label: 'Cost over time' },
    { id: 'sec-register', label: 'Expense register' },
  ],
  '/insurance': [
    { id: 'sec-mix', label: 'Cover gap' },
    { id: 'sec-register', label: 'Insurance register' },
  ],
  '/growth-assumptions': [
    { id: 'sec-register', label: 'Assumptions' },
  ],
  '/profile': [
    { id: 'sec-register', label: 'Your details' },
  ],
}

const ADMIN_SECTIONS = {
  dashboard: PAGE_SECTIONS['/'],
  assets: PAGE_SECTIONS['/assets'],
  'work-assets': PAGE_SECTIONS['/work-assets'],
  goals: PAGE_SECTIONS['/goals'],
  loans: PAGE_SECTIONS['/loans'],
  expenses: PAGE_SECTIONS['/expenses'],
  insurance: PAGE_SECTIONS['/insurance'],
}

function BrandMark({ to = '/' }) {
  return (
    <Link className="lm-brand" to={to}>
      <span className="lm-mark" />
      <span>
        <span className="lm-brand-name">LifeMap</span>
        <span className="lm-brand-by">by BOX Wealth</span>
      </span>
    </Link>
  )
}

export default function Shell({ children, adminMode = false, activeSection, onSectionChange, adminUserName, userName, onBack }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, admin, logout, adminLogout } = useAuth()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { isChartVisible, chartData, closeChart, toggleChart } = useChart()
  const [stuck, setStuck] = useState(false)
  const [activeStab, setActiveStab] = useState('')

  const isMainPage = adminMode ? activeSection === 'dashboard' : location.pathname === '/'
  const hideExtraChrome = adminMode
    ? activeSection === 'insurance'
    : ['/profile', '/growth-assumptions', '/insurance'].includes(location.pathname)
  const shouldShowChart = !isMainPage && isChartVisible && !hideExtraChrome

  const sections = adminMode
    ? (ADMIN_SECTIONS[activeSection] || [])
    : (PAGE_SECTIONS[location.pathname] || [])

  useEffect(() => {
    setActiveStab(sections[0]?.id || '')
  }, [location.pathname, activeSection])

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 80)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!sections.length) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target?.id) setActiveStab(visible.target.id)
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0.1, 0.25, 0.5] }
    )
    sections.forEach((section) => {
      const el = document.getElementById(section.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [location.pathname, activeSection, children])

  const handleLogout = async () => {
    if (adminMode && admin) {
      await adminLogout()
      window.location.href = '/'
    } else {
      await logout()
      window.location.assign('/')
    }
  }

  const openAuth = (tab) => {
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { tab } }))
  }

  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveStab(id)
  }

  const isTabActive = (item) => (
    adminMode ? activeSection === item.value : location.pathname === item.path
  )

  return (
    <div className="lm-shell">
      <header className="lm-topbar">
        <div className="lm-tier lm-tier0">
          {adminMode && onSectionChange ? (
            <button type="button" className="lm-brand" onClick={() => onSectionChange('dashboard')}>
              <span className="lm-mark" />
              <span>
                <span className="lm-brand-name">LifeMap</span>
                <span className="lm-brand-by">by BOX Wealth</span>
              </span>
            </button>
          ) : (
            <BrandMark />
          )}
          <span className="lm-acts">
            {adminMode && onBack ? (
              <button type="button" className="lm-tlink" onClick={onBack}>All users</button>
            ) : null}
            {adminMode && admin ? (
              <span className="lm-tlink" style={{ cursor: 'default' }}>
                {userName ? `Viewing ${userName}` : (adminUserName || admin?.name || 'Admin')}
              </span>
            ) : user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="lm-tlink" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {user?.name || user?.email || 'Account'}
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link to="/profile" className="flex items-center gap-2 cursor-pointer">
                      <UserCircle className="h-4 w-4" />
                      Your Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/growth-assumptions" className="flex items-center gap-2 cursor-pointer">
                      <TrendingUp className="h-4 w-4" />
                      Growth Assumptions
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setTheme((resolvedTheme || theme) === 'dark' ? 'light' : 'dark')}
                  >
                    {(resolvedTheme || theme) === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    {(resolvedTheme || theme) === 'dark' ? 'Light mode' : 'Dark mode'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 cursor-pointer text-red-600">
                    <LogOut className="h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button type="button" className="lm-tlink" onClick={() => openAuth('login')}>
                Sign in
              </button>
            )}
            {adminMode && admin ? (
              <button type="button" className="lm-btn" onClick={handleLogout}>Logout</button>
            ) : user ? (
              <button type="button" className="lm-btn" onClick={() => navigate('/profile')}>Save my plan</button>
            ) : (
              <button type="button" className="lm-btn" onClick={() => openAuth('login')}>Save my plan</button>
            )}
          </span>
        </div>

        <nav className="lm-tier lm-tier1" aria-label="Main areas">
          {navigationItems.map((item) => {
            const active = isTabActive(item)
            if (adminMode && onSectionChange) {
              return (
                <button
                  key={item.value}
                  type="button"
                  style={{ '--tone': item.tone }}
                  className={`lm-ptab ${active ? 'on' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSectionChange(item.value)}
                >
                  {item.label}
                </button>
              )
            }
            return (
              <Link
                key={item.path}
                to={item.path}
                style={{ '--tone': item.tone }}
                className={`lm-ptab ${active ? 'on' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      {sections.length > 0 && (
        <div className={`lm-tier2wrap ${stuck ? 'stuck' : ''}`}>
          <nav className="lm-tier lm-tier2" aria-label="Sections on this page">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`lm-stab ${activeStab === section.id ? 'on' : ''}`}
                onClick={() => scrollToSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      <main className="lm-main">
        {children}
      </main>

      {shouldShowChart && (
        <FloatingChartDock
          data={chartData}
          isVisible={shouldShowChart}
          onClose={closeChart}
          title="Life Sheet — Net Worth (real terms)"
        />
      )}

      {!isMainPage && !isChartVisible && !hideExtraChrome && (
        <ChartToggleButton onClick={toggleChart} />
      )}

      <footer className="lm-footer">
        <div className="lm-tier">
          <span className="lm-brand">
            <span className="lm-mark" />
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
    </div>
  )
}
