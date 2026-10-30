import { useCallback, useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import {
  api,
  type BoardingRecordRow,
  type BusRecord,
  type EmergencyRecord,
} from '../services/api'

/**
 * Operations dashboard.
 *
 * The four headline numbers are computed from the real tables, not from sample
 * data. "Students travelling" counts distinct students whose boarding was
 * granted today, which is what the transport desk actually needs.
 */

function isToday(value: string): boolean {
  const date = new Date(value)
  const now = new Date()

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function Dashboard() {
  const [buses, setBuses] = useState<BusRecord[]>([])
  const [records, setRecords] = useState<BoardingRecordRow[]>([])
  const [emergencies, setEmergencies] = useState<EmergencyRecord[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [busList, boarding, emergencyList] = await Promise.all([
        api.buses.list(),
        api.boarding.list(),
        api.emergency.list(),
      ])

      setBuses(busList)
      setRecords(boarding)
      setEmergencies(emergencyList)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the dashboard.')
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

  const todayGranted = records.filter(
    (record) => record.access_result === 'GRANTED' && isToday(record.boarded_at),
  )

  const travelling = new Set(todayGranted.map((record) => record.student_id)).size
  const openEmergencies = emergencies.filter(
    (event) => event.status === 'OPEN' || event.status === 'IN_PROGRESS',
  )
  const activeBuses = buses.filter((bus) => bus.status === 'ACTIVE').length
  const latest = records.slice(0, 6)

  return (
    <div className="page-stack">
      <section className="welcome-banner">
        <div>
          <p className="section-kicker">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
          <h2>Transport control</h2>
          <p>Live figures from the access-control backend.</p>
        </div>
        <div className="banner-time">
          <span>Access policy</span>
          <strong>Camera-only boarding</strong>
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

      <section className="stats-grid" aria-label="Transport summary">
        <StatCard label="Total Buses" value={String(buses.length)} detail="Fleet registered" tone="teal" />
        <StatCard label="Active Buses" value={String(activeBuses)} detail="Currently operational" tone="blue" />
        <StatCard label="Students Travelling" value={String(travelling)} detail="Boarded today" tone="amber" />
        <StatCard
          label="Emergencies"
          value={String(openEmergencies.length)}
          detail={openEmergencies.length === 0 ? 'All clear' : 'Requires attention'}
          tone="red"
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Access activity</p>
              <h2>Recent Boarding Activity</h2>
            </div>
            <span className="panel-count">{records.length} total</span>
          </div>

          <DataTable
            headers={['Student', 'Bus', 'Time', 'Result']}
            emptyMessage="No boarding activity yet."
          >
            {latest.map((record) => (
              <tr key={record.id}>
                <td>
                  <strong>{record.student_name ?? 'Unknown card'}</strong>
                  {record.denial_reason && (
                    <>
                      <br />
                      <span className="muted">{record.denial_reason.replaceAll('_', ' ')}</span>
                    </>
                  )}
                </td>
                <td>{record.bus_number ?? '—'}</td>
                <td>
                  {new Date(record.boarded_at).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td>
                  <StatusBadge
                    label={record.access_result}
                    tone={record.access_result === 'GRANTED' ? 'success' : 'danger'}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        </article>

        <article className="panel fleet-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Fleet snapshot</p>
              <h2>Buses</h2>
            </div>
            <span className="panel-count">{buses.length} vehicles</span>
          </div>

          <div className="fleet-list">
            {buses.slice(0, 4).map((bus) => (
              <div className="fleet-row" key={bus.id}>
                <div className="bus-avatar">{bus.bus_number.slice(-3)}</div>
                <div className="fleet-info">
                  <strong>{bus.bus_number}</strong>
                  <span>Capacity {bus.maximum_capacity}</span>
                </div>
                <StatusBadge
                  label={bus.status === 'ACTIVE' ? 'Active' : bus.status === 'MAINTENANCE' ? 'Maintenance' : 'Inactive'}
                  tone={bus.status === 'ACTIVE' ? 'success' : bus.status === 'MAINTENANCE' ? 'warning' : 'neutral'}
                />
              </div>
            ))}
          </div>
        </article>
      </section>

      {openEmergencies.length > 0 && (
        <article className="alert-panel">
          <div className="alert-symbol" aria-hidden="true">!</div>
          <div className="alert-copy">
            <p className="section-kicker">Needs attention</p>
            <h2>
              {openEmergencies[0].event_type} on {openEmergencies[0].bus_number}
            </h2>
            <p>
              {openEmergencies[0].location_status === 'GPS_FIX'
                ? `${openEmergencies[0].latitude}, ${openEmergencies[0].longitude}`
                : 'No GPS fix at the time of the report'}
            </p>
          </div>
          <StatusBadge label={openEmergencies[0].status} tone="danger" />
        </article>
      )}
    </div>
  )
}

export default Dashboard
