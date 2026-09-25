export function calculateCourseScore(criteria, findings) {
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (!totalWeight) return null;
  const earnedWeight = criteria.reduce((sum, criterion) => (
    findings[criterion.id]?.status === 'present' ? sum + criterion.weight : sum
  ), 0);
  return Number((earnedWeight / totalWeight * 100).toFixed(1));
}

export function meanScore(values) {
  const available = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return available.length
    ? Number((available.reduce((sum, value) => sum + value, 0) / available.length).toFixed(1))
    : null;
}
