import type { ReactNode } from 'react'

interface DataTableProps {
  headers: string[]
  children: ReactNode
  emptyMessage?: string
}

function DataTable({ headers, children, emptyMessage }: DataTableProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {emptyMessage && <p className="empty-table-message">{emptyMessage}</p>}
    </div>
  )
}

export default DataTable
