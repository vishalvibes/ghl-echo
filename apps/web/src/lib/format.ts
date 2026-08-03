export function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function delta(value: number): string {
  const points = Math.round(value * 100)
  if (points === 0) return '—'
  return `${points > 0 ? '▲' : '▼'} ${Math.abs(points)}pt`
}

export function duration(totalSec: number): string {
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `${min}m ${String(sec).padStart(2, '0')}s` : `${sec}s`
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function turnStamp(startMs: number | null): string {
  if (startMs === null) return ''
  const totalSec = Math.round(startMs / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}
