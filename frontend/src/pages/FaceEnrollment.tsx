import { useCallback, useEffect, useRef, useState } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import { ApiError, api, type FaceEnrollmentRow, type StudentRecord } from '../services/api'

/**
 * Face enrollment.
 *
 * Enrollment is what makes a student verifiable at the bus. The images are sent
 * to the backend, which forwards them to the face service; only a 128-number
 * embedding per sample is kept. No photo is stored on the server or returned to
 * this page.
 */

const MAX_IMAGES = 3

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result

      if (typeof result !== 'string') {
        reject(new Error('Could not read the selected file.'))
        return
      }

      // Strip the data URL prefix; the backend expects raw base64.
      resolve(result.includes(',') ? result.split(',', 2)[1] : result)
    }

    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.readAsDataURL(file)
  })
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function FaceEnrollment() {
  const [students, setStudents] = useState<StudentRecord[]>([])
  const [enrollments, setEnrollments] = useState<FaceEnrollmentRow[]>([])
  const [serviceAvailable, setServiceAvailable] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const [studentList, faceState] = await Promise.all([api.students.list(), api.face.list()])

      setStudents(studentList)
      setEnrollments(faceState.enrollments)
      setServiceAvailable(faceState.face_service_available)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load enrollment data.')
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

  function handleFiles(selected: FileList | null) {
    if (!selected) {
      return
    }

    const next = Array.from(selected).slice(0, MAX_IMAGES)
    setFiles(next)
    setMessage('')
    setError('')
  }

  async function handleEnroll() {
    const studentId = Number(selectedStudent)

    if (!studentId) {
      setError('Choose a student first.')
      return
    }

    if (files.length === 0) {
      setError('Choose one to three photos of the student.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    try {
      const images = await Promise.all(files.map(readAsBase64))
      const result = await api.face.enroll(studentId, images)

      setMessage(
        `Enrolled ${result.template_count} template${result.template_count === 1 ? '' : 's'} with ${result.engine}.`,
      )
      setFiles([])

      if (inputRef.current) {
        inputRef.current.value = ''
      }

      await load()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_FACE') {
        setError(
          'This face is already enrolled for another student. One person cannot hold two records.',
        )
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Enrollment failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(studentId: number, name: string) {
    if (!window.confirm(`Remove the face enrollment for ${name}? They will be denied until re-enrolled.`)) {
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    try {
      await api.face.remove(studentId)
      setMessage(`Enrollment removed for ${name}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the enrollment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="page-intro-row">
        <div>
          <p className="section-kicker">Identity</p>
          <h2>Face Enrollment</h2>
          <p>
            A student can only board once their face is enrolled here. The server keeps a
            128-number descriptor per sample, never the photo.
          </p>
        </div>
        <div className="directory-summary">
          <strong>{enrollments.length}</strong>
          <span>enrolled students</span>
        </div>
      </section>

      {!serviceAvailable && (
        <article className="alert-panel">
          <div className="alert-symbol" aria-hidden="true">!</div>
          <div className="alert-copy">
            <p className="section-kicker">Service unavailable</p>
            <h2>The face service is not running</h2>
            <p>
              Start it with <code>python face-service/app.py</code>. Until then every access
              attempt is denied with FACE SVC DOWN.
            </p>
          </div>
        </article>
      )}

      <article className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">New enrollment</p>
            <h3>Capture a reference face</h3>
          </div>
        </div>

        <div className="enroll-grid">
          <label className="field">
            <span>Student</span>
            <select
              value={selectedStudent}
              onChange={(event) => setSelectedStudent(event.target.value)}
            >
              <option value="">Select a student…</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.student_id} — {student.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Photos (1–3, front facing, even light)</span>
            <input
              ref={inputRef}
              accept="image/jpeg,image/png"
              multiple
              onChange={(event) => handleFiles(event.target.files)}
              type="file"
            />
          </label>

          <div className="field enroll-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void handleEnroll()}
              type="button"
            >
              {busy ? 'Working…' : 'Enroll face'}
            </button>
          </div>
        </div>

        {files.length > 0 && (
          <p className="enroll-note">
            {files.length} photo{files.length === 1 ? '' : 's'} selected: {files.map((file) => file.name).join(', ')}
          </p>
        )}

        {message && <p className="enroll-success">{message}</p>}
        {error && <p className="enroll-error" role="alert">{error}</p>}
      </article>

      <article className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h3>Enrolled students</h3>
            <p>Verification is required for every boarding</p>
          </div>
          <span className="panel-count">{enrollments.length} records</span>
        </div>

        <DataTable
          headers={['Student', 'Name', 'Templates', 'Engine', 'Last enrolled', 'Status', '']}
          emptyMessage={loading ? 'Loading…' : 'No student has been enrolled yet.'}
        >
          {enrollments.map((row) => (
            <tr key={row.student_id}>
              <td><span className="id-label">{row.student_code}</span></td>
              <td><strong>{row.name}</strong></td>
              <td>{row.template_count}</td>
              <td>{row.engine ?? '—'}</td>
              <td>{formatTimestamp(row.last_enrolled_at)}</td>
              <td>
                <StatusBadge
                  label={row.verification_enabled ? 'Active' : 'Disabled'}
                  tone={row.verification_enabled ? 'success' : 'neutral'}
                />
              </td>
              <td>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void handleRemove(row.student_id, row.name)}
                  type="button"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      </article>
    </div>
  )
}

export default FaceEnrollment
