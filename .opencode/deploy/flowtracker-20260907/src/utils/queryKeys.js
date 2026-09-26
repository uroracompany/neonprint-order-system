export const queryKeys = {
  kpiExecutive: (userId, bounds) => ['kpi', userId, 'executive-summary', bounds],
  kpiDetail: (userId, action, params) => ['kpi', userId, 'detail', action, params],
}
