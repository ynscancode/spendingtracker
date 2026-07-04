import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { useAuth } from './contexts/auth.js'
import { CategoriesProvider } from './contexts/CategoriesContext.jsx'
import { TransactionActivityProvider } from './contexts/TransactionActivityContext.jsx'
import Header from './components/layout/Header.jsx'
import AuthScreen from './components/auth/AuthScreen.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import TransactionsPage from './pages/TransactionsPage.jsx'
import BudgetPage from './pages/BudgetPage.jsx'

// BATCH 11 (user auth) gating, per the tech-lead contract's section G:
// - loading -> minimal splash (session-check-on-load hasn't resolved yet).
// - !user -> <AuthScreen> in place of the whole app (no routes, no header).
// - user -> the pre-existing app tree, with CategoriesProvider/
//   TransactionActivityProvider keyed by user.id so switching accounts
//   (Header's AccountSwitcher) REMOUNTS them and refetches user-scoped data
//   instead of leaking the previous user's categories/activity across the
//   switch.
function AppShell() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-splash" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <AuthScreen />
  }

  return (
    <CategoriesProvider key={user.id}>
      <TransactionActivityProvider key={user.id}>
        <div className="app">
          <Header />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/budget" element={<BudgetPage />} />
            </Routes>
          </main>
          {/* Modal portal target: sibling of app-main (not a descendant of any
              page's .page-animate wrapper, which has a transform-animation that
              would otherwise hijack position:fixed children), but still inside
              app-root so theme CSS custom properties cascade in correctly. */}
          <div id="modal-root" />
        </div>
      </TransactionActivityProvider>
    </CategoriesProvider>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
