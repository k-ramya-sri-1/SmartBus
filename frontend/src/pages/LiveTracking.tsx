import { useEffect } from 'react'
import BusMap from '../components/BusMap'
import StatusBadge from '../components/StatusBadge'
import socket, { connectSocket, disconnectSocket } from '../services/socket'

/**
 * Live tracking.
 *
 * The map subscribes to `gps_update` events; the connection is authenticated
 * with the session token, and the backend refuses anonymous subscribers.
 */

function LiveTracking() {
  useEffect(() => {
    const handleConnect = () => {
      console.log('Socket.IO connected:', socket.id)
    }

    const handleDisconnect = () => {
      console.log('Socket.IO disconnected')
    }

    const handleError = (error: Error) => {
      console.warn('Socket.IO rejected:', error.message)
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleError)

    connectSocket()

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleError)
      disconnectSocket()
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
              <span aria-hidden="true" /> Live
            </span>
          </div>

          <BusMap />
        </article>

        <aside className="panel tracking-list-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">On the move</p>
              <h2>Position feed</h2>
            </div>
            <span className="panel-count">GPS</span>
          </div>

          <p className="muted">
            Positions come from the NEO-6M on each bus unit. A unit without a fix is not shown
            on the map, because a guessed position is worse than no position.
          </p>

          <StatusBadge label="GPS_FIX required" tone="info" />
        </aside>
      </section>
    </div>
  )
}

export default LiveTracking
