const CLIENT_ACTIVITY_LABELS = {
  registered_clients: 'Clientes registrados',
  'Clientes registrados': 'Clientes registrados',
  active_clients: 'Clientes activos',
  'Clientes activos': 'Clientes activos',
  orders: 'Órdenes',
  Órdenes: 'Órdenes',
}

export const getClientActivityTooltipLabel = name => CLIENT_ACTIVITY_LABELS[name] || name
