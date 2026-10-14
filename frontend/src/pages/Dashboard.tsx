import DataTable from '../components/DataTable'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import { boardingActivity, buses, emergencyAlert } from '../services/mockData'

function Dashboard() {
  return (
    <div className="page-stack">
      <section className="welcome-banner">
        <div>
          <p className="section-kicker">Thursday, 02 October 2026</p>
          <h2>Good morning, Admin Desk</h2>
          <p>Here is the latest view of campus transport activity.</p>
        </div>
        <div className="banner-time">
          <span>Service window</span>
          <strong>07:30 — 18:30</strong>
        </div>
      </section>

      <section className="stats-grid" aria-label="Transport summary">
        <StatCard label="Total Buses" value="12" detail="Fleet registered" tone="teal" />
        <StatCard label="Active Buses" value="10" detail="Currently on route" tone="blue" />
        <StatCard label="Students Travelling" value="248" detail="Today's active riders" tone="amber" />
        <StatCard label="Emergencies" value="1" detail="Requires attention" tone="red" />
      </section>

      <section className="dashboard-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Access activity</p>
              <h2>Recent Boarding Activity</h2>
            </div>
            <button className="text-button" type="button">View all <span aria-hidden="true">→</span></button>
          </div>
          <DataTable headers={['Student', 'Bus', 'Time', 'Result']}>
            {boardingActivity.map((activity) => (
              <tr key={`${activity.student}-${activity.time}`}>
                <td><strong>{activity.student}</strong></td>
                <td>{activity.bus}</td>
                <td>{activity.time}</td>
                <td><StatusBadge label={activity.result} /></td>
              </tr>
            ))}
          </DataTable>
        </article>

        <article className="panel fleet-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Fleet snapshot</p>
              <h2>Active Buses</h2>
            </div>
            <span className="panel-count">4 routes</span>
          </div>
          <div className="fleet-list">
            {buses.slice(0, 4).map((bus) => (
              <div className="fleet-row" key={bus.id}>
                <div className="bus-avatar">{bus.number.slice(-3)}</div>
                <div className="fleet-info">
                  <strong>{bus.number}</strong>
                  <span>{bus.route} · {bus.passengers}/{bus.capacity} passengers</span>
                </div>
                <StatusBadge label={bus.status} />
              </div>
            ))}
          </div>
        </article>
      </section>

      <article className="alert-panel">
        <div className="alert-symbol" aria-hidden="true">!</div>
        <div className="alert-copy">
          <p className="section-kicker">Needs attention</p>
          <h2>Emergency alert on {emergencyAlert.bus}</h2>
          <p>Open incident · {emergencyAlert.studentsOnboard} students onboard · {emergencyAlert.location}</p>
        </div>
        <StatusBadge label={emergencyAlert.status} />
        <button className="secondary-button" type="button">Open center <span aria-hidden="true">→</span></button>
      </article>
    </div>
  )
}

export default Dashboard
