
import { useCallback, useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import { api, type BoardingRecordRow } from '../services/api'

/**
 * Access history.
 *
 * Displays boarding attempts, including attempts without an associated
 * student and the reason access was denied.
 */

function formatTime(value: string): string {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
}

function readableReason(reason: string | null): string {
  if (!reason) {
    return '—'
  }

  return reason.replaceAll('_', ' ')
}

function authenticationLabel(record: BoardingRecordRow): string {
  if (record.authentication_mode === 'CAMERA_ONLY') {
    return 'Camera-only'
  }

  if (record.authentication_mode === 'RFID') {
    return record.rfid_verified ? 'RFID verified' : 'RFID not verified'
  }

  return 'Unknown'
}

function authenticationTone(
  record: BoardingRecordRow,
): 'success' | 'neutral' {
  return record.authentication_mode === 'CAMERA_ONLY' ||
    (record.authentication_mode === 'RFID' &&
      Boolean(record.rfid_verified))
    ? 'success'
    : 'neutral'
}

function formatFaceScore(score: BoardingRecordRow['face_score']): string {
  if (score == null) {
    return '—'
  }

  const numericScore = Number(score)

  return Number.isFinite(numericScore)
    ? numericScore.toFixed(3)
    : '—'
}

function BoardingRecords() {
  const [records, setRecords] = useState<BoardingRecordRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const rows = await api.boarding.list()
      setRecords(rows)
      setError('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load the access log.',
      )
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
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [load])

  const granted = records.filter(
    (record) => record.access_result === 'GRANTED',
  ).length

  const denied = records.length - granted

  const successRate =
    records.length === 0
      ? 0
      : Math.round((granted / records.length) * 100)

  return (
    <div className="page-stack">
      <section className="page-intro-row">
        <div>
          <p className="section-kicker">Access history</p>
          <h2>Boarding Records</h2>
          <p>
            Every scan the reader has taken, with the evidence behind
            the decision.
          </p>
        </div>

        <div className="record-summary">
          <span className="summary-check">✓</span>
          <div>
            <strong>{successRate}%</strong>
            <span>{records.length} attempts</span>
          </div>
        </div>
      </section>

      {error && (
        <article className="panel">
          <p className="enroll-error" role="alert">
            {error}
          </p>
          <button
            className="secondary-button"
            onClick={() => void load()}
            type="button"
          >
            Retry
          </button>
        </article>
      )}

      <article className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h3>Access log</h3>
            <p>
              {granted} granted · {denied} denied · refreshes every 15 s
            </p>
          </div>

          <span className="panel-count">
            {records.length} records
          </span>
        </div>

        <DataTable
          headers={[
            'Student',
            'Bus',
            'Time',
            'Authentication',
            'Face',
            'Score',
            'GPS',
            'Result',
            'Reason',
          ]}
          emptyMessage={
            loading
              ? 'Loading…'
              : 'No access attempt has been recorded yet.'
          }
        >
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <strong>
                  {record.student_name ?? 'Unknown student'}
                </strong>
                <br />
                <span className="muted">
                  {record.student_code ??
                    record.attempted_rfid_uid ??
                    '—'}
                </span>
              </td>

              <td>
                {record.bus_number ? (
                  <span className="bus-label">
                    {record.bus_number}
                  </span>
                ) : (
                  '—'
                )}
              </td>

              <td>{formatTime(record.boarded_at)}</td>

              <td>
                <StatusBadge
                  label={authenticationLabel(record)}
                  tone={authenticationTone(record)}
                />
              </td>

              <td>
                <StatusBadge
                  label={
                    record.face_verified
                      ? 'Verified'
                      : 'Not verified'
                  }
                  tone={
                    record.face_verified ? 'success' : 'neutral'
                  }
                />
              </td>

              <td>{formatFaceScore(record.face_score)}</td>

              <td>
                {record.gps_status
                  ? record.gps_status.replace('GPS_', '')
                  : '—'}
              </td>

              <td>
                <StatusBadge
                  label={record.access_result}
                  tone={
                    record.access_result === 'GRANTED'
                      ? 'success'
                      : 'danger'
                  }
                />
              </td>

              <td>{readableReason(record.denial_reason)}</td>
            </tr>
          ))}
        </DataTable>
      </article>
    </div>
  )
}

export default BoardingRecords
