import { useCallback, useEffect, useState } from 'react'
import StatusBadge from '../components/StatusBadge'
import { api, type EmergencyRecord } from '../services/api'

/**
 * Emergency centre.
 *
 * Shows the real SOS events raised by the bus units. Allocation uses the
 * backend's route-aware, capacity-aware rescue engine; students who cannot be
 * placed are reported instead of being silently dropped.
 */

interface AllocationSummary {
  allocated: number
  unallocated: number
  buses: Array<{ bus_number: string; rescue_capacity: number; distance_km: number }>
}

function locationText(event: EmergencyRecord): string {
  if (event.location_status === 'UNAVAILABLE' || event.latitude === null || event.longitude === null) {
    return 'No GPS fix'
  }

  return `${Number(event.latitude).toFixed(5)}, ${Number(event.longitude).toFixed(5)}`
}

function EmergencyCenter() {
  const [events, setEvents] = useState<EmergencyRecord[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [allocation, setAllocation] = useState<{ eventId: number; summary: AllocationSummary } | null>(null)

  const load = useCallback(async () => {
    try {
      setEvents(await api.emergency.list())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load emergency events.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        void load()
      }
    })


    const timer = window.setInterval(() => {
      void load()
    }, 20000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [load])

  async function handleStatus(event: EmergencyRecord, status: EmergencyRecord['status']) {
    setBusyId(event.id)
    setError('')

    try {
      await api.emergency.setStatus(event.id, status)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the emergency.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleAllocate(event: EmergencyRecord) {
    setBusyId(event.id)
    setError('')

    try {
      const result = await api.emergency.allocate(event.id)

      setAllocation({
        eventId: event.id,
        summary: {
          allocated: result.allocated_student_count,
          unallocated: result.unallocated_student_count,
          buses: result.rescue_buses.map((bus) => ({
            bus_number: bus.bus_number,
            rescue_capacity: bus.rescue_capacity,
            distance_km: bus.distance_km,
          })),
        },
      })

      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescue allocation failed.')
    } finally {
      setBusyId(null)
    }
  }

  const open = events.filter((event) => event.status === 'OPEN' || event.status === 'IN_PROGRESS')

  return (
    <div className="page-stack emergency-page">
      <section className="page-intro-row emergency-intro">
        <div>
          <p className="section-kicker">Safety operations</p>
          <h2>Emergency Center</h2>
          <p>SOS events reported by the bus units, with the backend rescue engine.</p>
        </div>
        <div className="incident-count">
          <span aria-hidden="true">!</span>
          <div>
            <strong>{open.length}</strong>
            <span>open incident{open.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </section>

      {error && (
        <article className="panel">
          <p className="enroll-error" role="alert">{error}</p>
          <button className="secondary-button" onClick={() => void load()} type="button">
            Retry
          </button>
        </article>
      )}

      {!loading && open.length === 0 && (
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">All clear</p>
              <h3>No open incidents</h3>
            </div>
          </div>
          <p className="muted">
            Pressing SOS on a bus unit creates an event here within seconds.
          </p>
        </article>
      )}

      {open.map((event) => (
        <section className="emergency-grid" key={event.id}>
          <article className="panel incident-panel">
            <div className="incident-panel-heading">
              <div className="alert-symbol large" aria-hidden="true">!</div>
              <div>
                <p className="section-kicker">Priority incident</p>
                <h3>{event.event_type} · {event.bus_number}</h3>
              </div>
              <StatusBadge
                label={event.status}
                tone={event.status === 'OPEN' ? 'danger' : 'warning'}
              />
            </div>

            <div className="incident-details">
              <div><span>Bus</span><strong>{event.bus_number}</strong></div>
              <div><span>Location</span><strong>{locationText(event)}</strong></div>
              <div>
                <span>GPS</span>
                <strong>{event.location_status === 'GPS_FIX' ? 'Fix' : 'Unavailable'}</strong>
              </div>
              <div>
                <span>Reported</span>
                <strong>{new Date(event.created_at).toLocaleString()}</strong>
              </div>
            </div>

            {event.description && (
              <p className="muted">{event.description}</p>
            )}

            <div className="incident-actions">
              <button
                className="primary-button"
                disabled={busyId === event.id}
                onClick={() => void handleAllocate(event)}
                type="button"
              >
                {busyId === event.id ? 'Allocating…' : 'Run rescue allocation'}
              </button>
              <button
                className="secondary-button"
                disabled={busyId === event.id}
                onClick={() => void handleStatus(event, 'IN_PROGRESS')}
                type="button"
              >
                Mark in progress
              </button>
              <button
                className="secondary-button"
                disabled={busyId === event.id}
                onClick={() => void handleStatus(event, 'RESOLVED')}
                type="button"
              >
                Resolve
              </button>
            </div>

            {allocation && allocation.eventId === event.id && (
              <div className="allocation-summary">
                <p>
                  <strong>{allocation.summary.allocated}</strong> students allocated,{' '}
                  <strong>{allocation.summary.unallocated}</strong> still waiting.
                </p>
                {allocation.summary.buses.length === 0 ? (
                  <p className="muted">No bus had both route compatibility and spare capacity.</p>
                ) : (
                  <ul>
                    {allocation.summary.buses.map((bus) => (
                      <li key={bus.bus_number}>
                        {bus.bus_number} · {bus.rescue_capacity} seats free · {bus.distance_km} km away
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </article>

          <article className="panel map-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Location</p>
                <h3>Where the bus reported</h3>
              </div>
            </div>
            <p className="muted">
              {event.location_status === 'GPS_FIX'
                ? 'The unit had a live GPS fix when SOS was pressed.'
                : 'The unit had no GPS fix. The position is stored as unavailable rather than guessed.'}
            </p>
          </article>
        </section>
      ))}
    </div>
  )
}

export default EmergencyCenter
