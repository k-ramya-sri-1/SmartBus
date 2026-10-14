import { useEffect } from 'react'
import StatusBadge from '../components/StatusBadge'
import BusMap from '../components/BusMap'
import { buses } from '../services/mockData'
import socket from '../services/socket'

function LiveTracking() {
  useEffect(() => {
    const handleConnect = () => {
      console.log('Socket.IO connected:', socket.id)
    }

    const handleDisconnect = () => {
      console.log('Socket.IO disconnected')
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
    }
  }, [])

  return (
    <div className="page-stack">
      <section className="tracking-layout">
        <article className="panel map-panel">
          <div className="map-heading">
            <div>
              <p className="section-kicker">Live operations view</p>
              <h2>Live Bus Tracking</h2>
            </div>

            <span className="live-indicator">
              <span aria-hidden="true" /> Live preview
            </span>
          </div>

          {/* Phase 22: Leaflet + OpenStreetMap */}
          <BusMap />
        </article>

        <aside className="panel tracking-list-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">On the move</p>
              <h2>Active fleet</h2>
            </div>

            <span className="panel-count">3 buses</span>
          </div>

          <div className="tracking-bus-list">
            {buses.slice(0, 3).map((bus) => (
              <div className="tracking-bus" key={bus.id}>
                <div className="tracking-bus-icon" aria-hidden="true">
                  BUS
                </div>

                <div className="tracking-bus-copy">
                  <strong>{bus.number}</strong>
                  <span>{bus.route}</span>
                </div>

                <StatusBadge label={bus.status} />

                <div className="tracking-detail-grid">
                  <span>
                    Passengers <strong>{bus.passengers}</strong>
                  </span>

                  <span>
                    Capacity <strong>{bus.capacity}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  )
}

export default LiveTracking