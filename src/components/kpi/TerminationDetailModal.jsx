import CatalogAnalyticsDetailModal from './CatalogAnalyticsDetailModal'

export default function TerminationDetailModal({ termination, previousTermination, ...props }) {
  return (
    <CatalogAnalyticsDetailModal
      {...props}
      entity={termination}
      previousEntity={previousTermination}
      analyticsAction="terminations_analytics"
      entityIdField="termination_id"
      entityType="termination"
    />
  )
}
