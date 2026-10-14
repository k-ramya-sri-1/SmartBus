interface HeaderProps {
  title: string
  subtitle: string
}

function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="topbar">
      <div>
        <p className="topbar-kicker">SmartBus control room</p>
        <h1>{title}</h1>
        <p className="topbar-subtitle">{subtitle}</p>
      </div>
      <div className="operator-profile">
        <div className="operator-avatar">AD</div>
        <div>
          <strong>Admin Desk</strong>
          <span>Operations manager</span>
        </div>
      </div>
    </header>
  )
}

export default Header
