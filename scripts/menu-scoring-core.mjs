export function calculateItemScore(criteria, findings) {
  if (!criteria.length) return null;
  if (criteria.some(({ id }) => !['present', 'absent'].includes(findings[id]?.status))) return null;
  return criteria.some(({ id }) => findings[id].status === 'present') ? 100 : 0;
}

export function calculateSectionScore(criteria, items) {
  if (!criteria.length || !items.length) return null;
  const hasMissingFindings = items.some((item) => criteria.some(({ id }) => (
    !['present', 'absent'].includes(item.classifications?.[id]?.status)
  )));
  if (hasMissingFindings) return null;
  return items.some((item) => criteria.some(({ id }) => item.classifications[id].status === 'present')) ? 100 : 0;
}

export function meanScore(values) {
  const available = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return available.length
    ? Number((available.reduce((sum, value) => sum + value, 0) / available.length).toFixed(1))
    : null;
}
