import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import AuthModal from './AuthModal'
import { useAuth } from '../contexts/AuthContext'
import { useAdminUser } from '../contexts/AdminUserContext'
import { loadMockupState, mockupSrc, saveMockupState } from '../lib/mockupSync'
import ApiService from '../services/api'

export default function MockupHost({ page, accountLabel, onNavigate, onExit }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isAuthenticated, logout, loading: authLoading, admin } = useAuth()
  const adminUser = useAdminUser()
  const isAdminMode = !!adminUser?.userId
  const effectiveUserId = isAdminMode ? adminUser.userId : (user?.id || null)
  const owned = isAuthenticated || isAdminMode
  const iframeRef = useRef(null)
  const pendingSaveRef = useRef(null)
  const hydratedRef = useRef(false)
  const appliedRef = useRef(false)
  const statePromiseRef = useRef(null)
  const hydrateGenRef = useRef(0)
  const persistChainRef = useRef(Promise.resolve())
  const pageRef = useRef(page)
  const [authOpen, setAuthOpen] = useState(false)
  const [planReady, setPlanReady] = useState(false)
  const baseSrc = mockupSrc(page)
  const src = owned ? `${baseSrc}?owned=1` : baseSrc
  const displayName = accountLabel || user?.name || user?.email || 'Account'
  pageRef.current = page

  const api = () => iframeRef.current?.contentWindow?.__LIFEMAP__
  const syncOpts = isAdminMode ? { admin: true } : {}

  const hydrate = useCallback(async (userId) => {
    const bridge = api()
    if (!bridge) return
    const id = userId || effectiveUserId
    const gen = hydrateGenRef.current
    if (!id) {
      hydratedRef.current = true
      appliedRef.current = true
      if (gen === hydrateGenRef.current) setPlanReady(true)
      return
    }
    if (appliedRef.current) return
    appliedRef.current = true
    try {
      const pending = statePromiseRef.current
      const state = pending ? await pending : await loadMockupState(page, id, syncOpts)
      if (gen !== hydrateGenRef.current) {
        appliedRef.current = false
        return
      }
      if (state) bridge.setState(state)
      bridge.setAccount(displayName)
      hydratedRef.current = true
      setPlanReady(true)
    } catch (error) {
      appliedRef.current = false
      if (gen !== hydrateGenRef.current) return
      hydratedRef.current = true
      setPlanReady(true)
      console.error('Failed to hydrate mockup from API', error)
    }
  }, [page, effectiveUserId, displayName, isAdminMode])

  const persist = useCallback((state, quiet, userId) => {
    const pageAtCall = pageRef.current
    const job = persistChainRef.current.then(async () => {
      if (pageRef.current !== pageAtCall) return
      const snapshot = api()?.getState() || state
      const id = userId || effectiveUserId
      if (!id) {
        pendingSaveRef.current = snapshot
        setAuthOpen(true)
        return
      }
      if (!hydratedRef.current) {
        if (!quiet) toast.message('Still loading your plan')
        return
      }
      try {
        await saveMockupState(pageAtCall, id, snapshot, syncOpts)
        const bridge = api()
        if (bridge) bridge.setAccount(displayName)
        if (!quiet) toast.success('Plan saved')
      } catch (error) {
        console.error('Failed to save mockup', error)
        toast.error(error.message || 'Could not save your plan')
      }
    })
    persistChainRef.current = job.catch(() => {})
    return job
  }, [effectiveUserId, displayName, isAdminMode])

  useEffect(() => {
    hydrateGenRef.current += 1
    hydratedRef.current = false
    appliedRef.current = false
    persistChainRef.current = Promise.resolve()
    setPlanReady(false)
    if (effectiveUserId) {
      statePromiseRef.current = loadMockupState(page, effectiveUserId, syncOpts)
    } else {
      statePromiseRef.current = null
      if (!authLoading) setPlanReady(true)
    }
  }, [page, effectiveUserId, authLoading, isAdminMode])

  useEffect(() => {
    if (!isAuthenticated && !isAdminMode) api()?.setAccount(null)
  }, [isAuthenticated, isAdminMode])

  useEffect(() => {
    if (authLoading || isAdminMode) return
    if (admin?.role === 'super_admin') {
      navigate('/super-admin', { replace: true })
      return
    }
    if (admin) {
      navigate('/admin', { replace: true })
      return
    }
    if (new URLSearchParams(location.search).get('signin')) setAuthOpen(true)
  }, [authLoading, admin, isAdminMode, location.search, navigate])

  useEffect(() => {
    if (authOpen) return
    if (pendingSaveRef.current) return
    if (effectiveUserId) hydrate(effectiveUserId)
  }, [authOpen, hydrate, effectiveUserId])

  const onAuthenticated = useCallback(async ({ mode, user: authed } = {}) => {
    const id = authed?.id
    const pending = pendingSaveRef.current
    if (mode === 'register' && pending && id) {
      try {
        await saveMockupState(page, id, pending)
        pendingSaveRef.current = null
        hydratedRef.current = true
        appliedRef.current = true
        setAuthOpen(false)
        const bridge = api()
        if (bridge && pending) bridge.setState(pending)
        if (bridge) bridge.setAccount(authed?.name || authed?.email || 'Account')
        setPlanReady(true)
        toast.success('Plan saved')
      } catch (error) {
        pendingSaveRef.current = null
        setAuthOpen(false)
        setPlanReady(true)
        console.error('Failed to save mockup after register', error)
        toast.error(error.message || 'Could not save your plan')
      }
      return
    }
    pendingSaveRef.current = null
    setAuthOpen(false)
    if (id) await hydrate(id)
  }, [hydrate, page])

  useEffect(() => {
    const onMessage = (event) => {
      const data = event.data
      if (!data || data.source !== 'lifemap-mockup') return
      if (data.page && data.page !== page) return

      if (data.type === 'ready') {
        if (!pendingSaveRef.current) hydrate()
        return
      }
      if (data.type === 'navigate' && data.payload?.path) {
        const path = data.payload.path
        const go = () => {
          if (onNavigate) onNavigate(path)
          else navigate(path)
        }
        if (owned && hydratedRef.current) {
          persist(null, true).finally(go)
        } else {
          go()
        }
        return
      }
      if (data.type === 'logout') {
        if (onExit) {
          onExit()
          return
        }
        logout().finally(() => {
          api()?.setAccount(null)
          window.location.assign('/')
        })
        return
      }
      if (data.type === 'auth') {
        if (isAdminMode) return
        if (isAuthenticated) {
          navigate('/profile')
          return
        }
        setAuthOpen(true)
        return
      }
      if (data.type === 'save') {
        persist(data.payload, false)
        return
      }
      if (data.type === 'row-save' || data.type === 'row-delete') {
        persist(null, true)
        return
      }
      if (data.type === 'classify') {
        const description = String(data.payload?.description || '').trim()
        const rowId = data.payload?.id
        if (!description || !effectiveUserId) return
        const classify = isAdminMode
          ? ApiService.classifyExpenseForUser(description, effectiveUserId)
          : ApiService.classifyExpense(description, effectiveUserId)
        classify
          .then((result) => {
            api()?.applyClassify?.({
              id: rowId,
              category: result?.category || result?.subcategory || '',
              subcategory: result?.subcategory || '',
            })
          })
          .catch((error) => console.warn('Expense classify skipped', error))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [hydrate, isAuthenticated, isAdminMode, logout, navigate, onNavigate, onExit, owned, page, persist, effectiveUserId])

  return (
    <div className={`lm-mockup-host${isAdminMode ? ' is-admin' : ''}`}>
      <iframe
        key={src}
        ref={iframeRef}
        className="lm-mockup-frame"
        title="LifeMap"
        src={src}
        style={{ visibility: planReady ? 'visible' : 'hidden' }}
        onLoad={() => {
          if (!pendingSaveRef.current) hydrate()
        }}
      />
      {isAdminMode ? null : (
        <AuthModal
          isOpen={authOpen}
          onClose={() => {
            setAuthOpen(false)
            pendingSaveRef.current = null
          }}
          onAuthenticated={onAuthenticated}
        />
      )}
    </div>
  )
}
