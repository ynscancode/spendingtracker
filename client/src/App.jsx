import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { CategoriesProvider } from './contexts/CategoriesContext.jsx'
import Header from './components/layout/Header.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import TransactionsPage from './pages/TransactionsPage.jsx'
import BreakdownPage from './pages/BreakdownPage.jsx'
import BudgetPage from './pages/BudgetPage.jsx'

function App() {
  return (
    <ThemeProvider>
      <CategoriesProvider>
        <div className="app">
          <Header />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/breakdown" element={<BreakdownPage />} />
              <Route path="/budget" element={<BudgetPage />} />
            </Routes>
          </main>
        </div>
      </CategoriesProvider>
    </ThemeProvider>
  )
}

export default App
