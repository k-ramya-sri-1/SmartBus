import { useCallback, useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import { api, type BusRecord } from '../services/api'

/**
 * Fleet view backed by the real bus table. Occupancy is not shown as a
 * trustworthy number here: the honest source is the boarding log, which the
 * Access log page shows in full.
 */

function Buses() {
  const [buses, setBuses] = useState<BusRecord[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setBuses(await api.buses.list())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the fleet.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // The loader updates state, so it must not run inside the effect body;
    // deferring by a microtask keeps the first paint free of a render cascade.
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        void load()
      }
    })

    return () => {
      cancelled = true
    }
  }, [load])

  return (
    <div className="page-stack">
      <section className="page-intro-row">
        <div>
          <p className="section-kicker">Fleet directory</p>
          <h2>Buses</h2>
          <p>Operational capacity and vehicle availability as registered on the backend.</p>
        </div>
        <div className="directory-summary">
          <strong>{buses.length}</strong>
          <span>registered vehicles</span>
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

      <article className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h3>Fleet overview</h3>
            <p>Capacity is the maximum operational capacity used by the rescue engine</p>
          </div>
          <span className="panel-count">{loading ? 'Loading…' : `${buses.length} buses`}</span>
        </div>

        <DataTable
          headers={['ID', 'Bus number', 'Registration', 'Max capacity', 'Status']}
          emptyMessage={loading ? 'Loading…' : 'No buses registered.'}
        >
          {buses.map((bus) => (
            <tr key={bus.id}>
              <td><span className="id-label">{bus.id}</span></td>
              <td><strong>{bus.bus_number}</strong></td>
              <td>{bus.registration_number ?? '—'}</td>
              <td>{bus.maximum_capacity} seats</td>
              <td>
                <StatusBadge
                  label={bus.status === 'ACTIVE' ? 'Active' : bus.status === 'MAINTENANCE' ? 'Maintenance' : 'Inactive'}
                  tone={bus.status === 'ACTIVE' ? 'success' : bus.status === 'MAINTENANCE' ? 'warning' : 'neutral'}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      </article>
    </div>
  )
}

export default Buses
