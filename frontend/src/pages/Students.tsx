import { useState } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import { students } from '../services/mockData'

function Students() {
  const [searchTerm, setSearchTerm] = useState('')
  const normalizedSearch = searchTerm.toLowerCase()
  const filteredStudents = students.filter((student) =>
    [student.id, student.name, student.rfid, student.bus, student.route]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch),
  )

  return (
    <div className="page-stack">
      <section className="page-intro-row">
        <div>
          <p className="section-kicker">Rider directory</p>
          <h2>Students</h2>
          <p>Manage student transport assignments and access status.</p>
        </div>
        <div className="directory-summary"><strong>{students.length}</strong><span>sample records</span></div>
      </section>
      <article className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h3>Student directory</h3>
            <p>Static Phase 21 preview data</p>
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
        <DataTable headers={['Student ID', 'Name', 'RFID', 'Assigned Bus', 'Route', 'Status']}>
          {filteredStudents.map((student) => (
            <tr key={student.id}>
              <td><span className="id-label">{student.id}</span></td>
              <td><strong>{student.name}</strong></td>
              <td>{student.rfid}</td>
              <td><span className="bus-label">{student.bus}</span></td>
              <td>{student.route}</td>
              <td><StatusBadge label={student.status} /></td>
            </tr>
          ))}
        </DataTable>
        {filteredStudents.length === 0 && <p className="empty-table-message">No students match your search.</p>}
      </article>
    </div>
  )
}

export default Students
