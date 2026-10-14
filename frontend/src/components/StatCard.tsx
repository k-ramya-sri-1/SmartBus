interface StatCardProps {
  label: string
  value: string
  detail: string
  tone: 'teal' | 'blue' | 'amber' | 'red'
}

function StatCard({ label, value, detail, tone }: StatCardProps) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <div className="stat-card-topline">
        <span className="stat-dot" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

export default StatCard
