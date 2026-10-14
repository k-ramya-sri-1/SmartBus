import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import { boardingRecords } from '../services/mockData'

function BoardingRecords() {
  return (
    <div className="page-stack">
      <section className="page-intro-row">
        <div>
          <p className="section-kicker">Access history</p>
          <h2>Boarding Records</h2>
          <p>Review the latest static RFID and face verification results.</p>
        </div>
        <div className="record-summary"><span className="summary-check">✓</span><div><strong>94%</strong><span>verification success</span></div></div>
      </section>
      <article className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h3>Today's boarding log</h3>
            <p>Morning route window · 08:00 — 09:00</p>
          </div>
          <span className="panel-count">{boardingRecords.length} records</span>
        </div>
        <DataTable headers={['Student', 'Bus', 'Time', 'RFID', 'Face', 'Result']}>
          {boardingRecords.map((record) => (
            <tr key={`${record.student}-${record.time}`}>
              <td><strong>{record.student}</strong></td>
              <td><span className="bus-label">{record.bus}</span></td>
              <td>{record.time}</td>
              <td><StatusBadge label={record.rfid} /></td>
              <td><StatusBadge label={record.face} /></td>
              <td><StatusBadge label={record.result} /></td>
            </tr>
          ))}
        </DataTable>
      </article>
    </div>
  )
}

export default BoardingRecords
