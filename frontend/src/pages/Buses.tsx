import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import { buses } from '../services/mockData'

function Buses() {
  return (
    <div className="page-stack">
      <section className="page-intro-row">
        <div>
          <p className="section-kicker">Fleet directory</p>
          <h2>Buses</h2>
          <p>Review assigned routes, passenger loads, and vehicle availability.</p>
        </div>
        <div className="directory-summary"><strong>{buses.length}</strong><span>sample vehicles</span></div>
      </section>
      <article className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h3>Fleet overview</h3>
            <p>Capacity and occupancy at a glance</p>
          </div>
          <button className="secondary-button" type="button">Export view <span aria-hidden="true">↓</span></button>
        </div>
        <DataTable headers={['Bus ID', 'Bus Number', 'Route', 'Capacity', 'Passengers', 'Status']}>
          {buses.map((bus) => (
            <tr key={bus.id}>
              <td><span className="id-label">{bus.id}</span></td>
              <td><strong>{bus.number}</strong></td>
              <td>{bus.route}</td>
              <td>{bus.capacity} seats</td>
              <td>
                <div className="occupancy-cell">
                  <span>{bus.passengers}</span>
                  <span className="occupancy-track"><span style={{ width: `${(bus.passengers / bus.capacity) * 100}%` }} /></span>
                </div>
              </td>
              <td><StatusBadge label={bus.status} /></td>
            </tr>
          ))}
        </DataTable>
      </article>
    </div>
  )
}

export default Buses
