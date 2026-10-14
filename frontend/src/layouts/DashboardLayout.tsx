import type { ReactNode } from 'react'
import type { PageKey } from '../types'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'

interface DashboardLayoutProps {
  currentPage: PageKey
  title: string
  subtitle: string
  onNavigate: (page: PageKey) => void
  onLogout: () => void
  children: ReactNode
}

function DashboardLayout({
  currentPage,
  title,
  subtitle,
  onNavigate,
  onLogout,
  children,
}: DashboardLayoutProps) {
  return (
    <div className="app-shell">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} onLogout={onLogout} />
      <div className="main-area">
        <Header title={title} subtitle={subtitle} />
        <main className="content-area">{children}</main>
      </div>
    </div>
  )
}

export default DashboardLayout
