import { useState } from 'react'
import StatusBadge from '../components/StatusBadge'
import { emergencyAlert } from '../services/mockData'

const rescueBuses = [
  { number: 'BUS002', seats: 6, route: 'Route B' },
  { number: 'BUS003', seats: 10, route: 'Route C' },
  { number: 'BUS004', seats: 11, route: 'Route D' },
]

function EmergencyCenter() {
  const [allocatedBus, setAllocatedBus] = useState<string | null>(null)

  return (
    <div className="page-stack emergency-page">
      <section className="page-intro-row emergency-intro">
        <div>
          <p className="section-kicker">Safety operations</p>
          <h2>Emergency Center</h2>
          <p>Coordinate a clear response when a route needs immediate support.</p>
        </div>
        <div className="incident-count"><span aria-hidden="true">!</span><div><strong>1</strong><span>open incident</span></div></div>
      </section>

      <section className="emergency-grid">
        <article className="panel incident-panel">
          <div className="incident-panel-heading">
            <div className="alert-symbol large" aria-hidden="true">!</div>
            <div>
              <p className="section-kicker">Priority incident</p>
              <h3>Emergency alert</h3>
            </div>
            <StatusBadge label={emergencyAlert.status} />
          </div>
          <div className="incident-details">
            <div><span>Bus</span><strong>{emergencyAlert.bus}</strong></div>
            <div><span>Location</span><strong>{emergencyAlert.location}</strong></div>
            <div><span>Students onboard</span><strong>{emergencyAlert.studentsOnboard}</strong></div>
            <div><span>Reported</span><strong>08:32 AM</strong></div>
          </div>
          <div className="incident-note"><span aria-hidden="true">i</span><p>Rescue allocation is a frontend demonstration. Backend dispatch will be connected in a later phase.</p></div>
        </article>

        <article className="panel rescue-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Available support</p>
              <h3>Suitable Rescue Buses</h3>
            </div>
            <span className="panel-count">3 options</span>
          </div>
          <div className="rescue-list">
            {rescueBuses.map((bus) => (
              <div className={allocatedBus === bus.number ? 'rescue-option selected' : 'rescue-option'} key={bus.number}>
                <div className="rescue-bus-icon" aria-hidden="true">BUS</div>
                <div><strong>{bus.number}</strong><span>{bus.route}</span></div>
                <div className="seat-count"><strong>{bus.seats}</strong><span>seats</span></div>
                <button className="icon-button" onClick={() => setAllocatedBus(bus.number)} type="button" aria-label={`Allocate ${bus.number}`}>
                  {allocatedBus === bus.number ? '✓' : '+'}
                </button>
              </div>
            ))}
          </div>
          <button className="primary-button allocate-button" onClick={() => setAllocatedBus(allocatedBus ?? rescueBuses[0].number)} type="button">
            {allocatedBus ? `Allocated to ${allocatedBus}` : 'Allocate rescue'}
            <span aria-hidden="true">→</span>
          </button>
        </article>
      </section>
    </div>
  )
}

export default EmergencyCenter
