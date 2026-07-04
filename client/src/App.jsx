import { Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { CategoriesProvider } from './contexts/CategoriesContext.jsx'
import { TransactionActivityProvider } from './contexts/TransactionActivityContext.jsx'
import Header from './components/layout/Header.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import TransactionsPage from './pages/TransactionsPage.jsx'
import BudgetPage from './pages/BudgetPage.jsx'

function App() {
  return (
    <ThemeProvider>
      <CategoriesProvider>
        <TransactionActivityProvider>
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
          <Analytics />
        </TransactionActivityProvider>
      </CategoriesProvider>
    </ThemeProvider>
  )
}

export default App
