import { useCallback, useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import {
  api,
  type AssignmentRecord,
  type BusRecord,
  type FaceEnrollmentRow,
  type RfidCardRecord,
  type RouteRecord,
  type StudentRecord,
} from '../services/api'

/**
 * Student directory, joined from the real tables: student record, RFID card,
 * permanent assignment and face enrollment. A student without a face template
 * cannot board, so that is shown explicitly instead of being left to chance.
 */

function Students() {
  const [students, setStudents] = useState<StudentRecord[]>([])
  const [cards, setCards] = useState<RfidCardRecord[]>([])
  const [buses, setBuses] = useState<BusRecord[]>([])
  const [routes, setRoutes] = useState<RouteRecord[]>([])
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([])
  const [enrollments, setEnrollments] = useState<FaceEnrollmentRow[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [studentList, cardList, busList, routeList, assignmentList, faceState] =
        await Promise.all([
          api.students.list(),
          api.rfid.list(),
          api.buses.list(),
          api.routes.list(),
          api.assignments.list(),
          api.face.list(),
        ])

      setStudents(studentList)
      setCards(cardList)
      setBuses(busList)
      setRoutes(routeList)
      setAssignments(assignmentList)
      setEnrollments(faceState.enrollments)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the student directory.')
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

  const normalizedSearch = searchTerm.toLowerCase().trim()

  const rows = students
    .map((student) => {
      const card = cards.find((item) => item.student_id === student.id)
      const assignment = assignments.find(
        (item) => item.student_id === student.id && item.assignment_status === 'ACTIVE',
      )
      const bus = assignment ? buses.find((item) => item.id === assignment.bus_id) : undefined
      const route = assignment ? routes.find((item) => item.id === assignment.route_id) : undefined
      const enrollment = enrollments.find((item) => item.student_id === student.id)

      return {
        student,
        card,
        bus,
        route,
        enrollment,
      }
    })
    .filter((row) => {
      if (!normalizedSearch) {
        return true
      }

      return [
        row.student.student_id,
        row.student.name,
        row.card?.rfid_uid ?? '',
        row.bus?.bus_number ?? '',
        row.route?.route_name ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    })

  return (
    <div className="page-stack">
      <section className="page-intro-row">
        <div>
          <p className="section-kicker">Rider directory</p>
          <h2>Students</h2>
          <p>Cards, assignments and face enrollment as the backend actually holds them.</p>
        </div>
        <div className="directory-summary">
          <strong>{students.length}</strong>
          <span>registered students</span>
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
            <h3>Student directory</h3>
            <p>{loading ? 'Loading…' : 'Live data from the backend'}</p>
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search students</span>
            <input
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search students"
              type="search"
              value={searchTerm}
            />
          </label>
        </div>

        <DataTable
          headers={['Student ID', 'Name', 'RFID', 'Bus', 'Route', 'Face', 'Status']}
          emptyMessage={loading ? 'Loading…' : 'No students match your search.'}
        >
          {rows.map(({ student, card, bus, route, enrollment }) => (
            <tr key={student.id}>
              <td><span className="id-label">{student.student_id}</span></td>
              <td><strong>{student.name}</strong></td>
              <td>{card ? card.rfid_uid : <span className="muted">no card</span>}</td>
              <td>{bus ? <span className="bus-label">{bus.bus_number}</span> : '—'}</td>
              <td>{route ? route.route_name : '—'}</td>
              <td>
                {enrollment && enrollment.template_count > 0 ? (
                  <StatusBadge label="Enrolled" tone="success" />
                ) : (
                  <StatusBadge label="Not enrolled" tone="warning" />
                )}
              </td>
              <td>
                <StatusBadge
                  label={student.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  tone={student.status === 'ACTIVE' ? 'success' : 'neutral'}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      </article>
    </div>
  )
}

export default Students
