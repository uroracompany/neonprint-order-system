import CatalogAnalyticsDetailModal from './CatalogAnalyticsDetailModal'

export default function MaterialDetailModal({ material, previousMaterial, ...props }) {
  return (
    <CatalogAnalyticsDetailModal
      {...props}
      entity={material}
      previousEntity={previousMaterial}
      analyticsAction="materials_analytics"
      entityIdField="material_id"
      entityType="material"
    />
  )
}
