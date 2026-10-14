interface StatusBadgeProps {
  label: string
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'info'
}

function getTone(label: string): StatusBadgeProps['tone'] {
  const normalizedLabel = label.toLowerCase()

  if (normalizedLabel === 'active' || normalizedLabel === 'granted' || normalizedLabel === 'verified') {
    return 'success'
  }

  if (normalizedLabel === 'open' || normalizedLabel === 'maintenance') {
    return 'warning'
  }

  if (normalizedLabel === 'denied') {
    return 'danger'
  }

  if (normalizedLabel === 'inactive' || normalizedLabel === 'not verified') {
    return 'neutral'
  }

  return 'info'
}

function StatusBadge({ label, tone }: StatusBadgeProps) {
  return <span className={`status-badge status-${tone ?? getTone(label)}`}>{label}</span>
}

export default StatusBadge
