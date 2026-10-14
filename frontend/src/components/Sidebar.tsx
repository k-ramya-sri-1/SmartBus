import type { PageKey } from '../types'

interface SidebarProps {
  currentPage: PageKey
  onNavigate: (page: PageKey) => void
  onLogout: () => void
}

const navigationItems: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'tracking', label: 'Live Bus Tracking', icon: '◉' },
  { key: 'students', label: 'Students', icon: '♙' },
  { key: 'buses', label: 'Buses', icon: '▰' },
  { key: 'boarding', label: 'Boarding Records', icon: '✓' },
  { key: 'emergency', label: 'Emergency Center', icon: '!' },
]

function Sidebar({ currentPage, onNavigate, onLogout }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          SB
        </div>
        <div>
          <strong>SmartBus</strong>
          <span>Transport control</span>
        </div>
      </div>

      <div className="sidebar-section-label">Workspace</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {navigationItems.map((item) => (
          <button
            className={currentPage === item.key ? 'nav-item active' : 'nav-item'}
            key={item.key}
            onClick={() => onNavigate(item.key)}
            type="button"
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="system-status">
          <span className="status-pulse" aria-hidden="true" />
          <div>
            <strong>System online</strong>
            <span>All services operational</span>
          </div>
        </div>
        <button className="logout-button" onClick={onLogout} type="button">
          Sign out
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
