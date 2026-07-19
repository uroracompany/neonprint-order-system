import { requireAdmin } from './auth-middleware.js'
import { createClient } from '@supabase/supabase-js'

export async function handleKpiData(body, env) {
  const authResult = await requireAdmin(env.authHeader, env)
  if (!authResult.authorized) {
    return { status: 401, body: { error: authResult.error } }
  }

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return { status: 500, body: { error: 'Configuración de Supabase incompleta' } }
  }

  const accessToken = String(env.authHeader || '').replace(/^Bearer\s+/i, '').trim()
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })

  try {
    const {
      action = 'business_summary',
      date_from = null,
      date_to = null,
      compare_from = null,
      compare_to = null,
    } = body

    let result

    switch (action) {
      case 'business_summary': {
        const { data, error } = await supabase.rpc('kpi_business_summary', {
          p_date_from: date_from, p_date_to: date_to,
          p_compare_from: compare_from, p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'orders_analytics': {
        const { data, error } = await supabase.rpc('kpi_orders_analytics', {
          p_date_from: date_from, p_date_to: date_to,
          p_compare_from: compare_from, p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'client_analytics': {
        const { data, error } = await supabase.rpc('kpi_client_analytics', {
          p_date_from: date_from, p_date_to: date_to,
          p_compare_from: compare_from, p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'user_analytics': {
        const { data, error } = await supabase.rpc('kpi_user_analytics', {
          p_date_from: date_from, p_date_to: date_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'production_insights': {
        const { data, error } = await supabase.rpc('kpi_production_insights', {
          p_date_from: date_from, p_date_to: date_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'smart_alerts': {
        const { data, error } = await supabase.rpc('kpi_smart_alerts')
        if (error) throw error
        result = data
        break
      }

      case 'orders_trend': {
        const { data, error } = await supabase.rpc('kpi_orders_trend', { p_days: 30 })
        if (error) throw error
        result = data
        break
      }

      case 'sales_overview': {
        const { data, error } = await supabase.rpc('kpi_sales_overview', {
          p_date_from: date_from,
          p_date_to: date_to,
          p_compare_from: compare_from,
          p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'seller_detail': {
        const { seller_id } = body
        if (!seller_id) return { status: 400, body: { error: 'seller_id es requerido' } }
        const { data, error } = await supabase.rpc('kpi_seller_detail', {
          p_seller_id: seller_id,
          p_date_from: date_from,
          p_date_to: date_to,
          p_compare_from: compare_from,
          p_compare_to: compare_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'seller_daily_trend': {
        const { metric = 'orders' } = body
        const { data, error } = await supabase.rpc('kpi_seller_daily_trend', {
          p_metric: metric,
          p_date_from: date_from,
          p_date_to: date_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'seller_profile': {
        const { seller_id } = body
        if (!seller_id) return { status: 400, body: { error: 'seller_id es requerido' } }

        let ordersQuery = supabase.from('orders')
          .select('client_id, client_name, material, status, payment_status, created_at')
          .or(`seller_id.eq.${seller_id},created_by.eq.${seller_id}`)
        if (date_from) ordersQuery = ordersQuery.gte('created_at', date_from)
        if (date_to) ordersQuery = ordersQuery.lt('created_at', date_to)

        const { data: ordersData, error: ordersError } = await ordersQuery
        if (ordersError) throw ordersError

        const clientMap = {}
        ;(ordersData || []).forEach(o => {
          const name = (o.client_name || '').trim()
          if (!name) return
          if (!clientMap[name]) clientMap[name] = { client_id: o.client_id, client_name: name, total: 0, completed: 0, cancelled: 0 }
          clientMap[name].total++
          const st = (o.status || '').toLowerCase()
          if (st === 'in_completed' || st === 'in_delivered') clientMap[name].completed++
          if (st === 'cancelled') clientMap[name].cancelled++
        })

        const top_clients = Object.values(clientMap)
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
          .map(c => ({
            client_id: c.client_id,
            client_name: c.client_name,
            total_orders: c.total,
            completed_orders: c.completed,
            cancel_rate: c.total > 0 ? Math.round(c.cancelled / c.total * 1000) / 10 : 0,
          }))

        const matMap = {}
        let totalMatCount = 0
        ;(ordersData || []).forEach(o => {
          if (!o.material) return
          o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
            matMap[m] = (matMap[m] || 0) + 1
            totalMatCount++
          })
        })

        const materials = Object.entries(matMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([name, count]) => ({
            name,
            count,
            pct: totalMatCount > 0 ? Math.round(count / totalMatCount * 1000) / 10 : 0,
          }))

        const days = (date_from && date_to) ? Math.max((new Date(date_to) - new Date(date_from)) / 86400000, 1) : 30
        const totalOrders = (ordersData || []).length

        const lastOrderDate = totalOrders > 0
          ? new Date(Math.max(...ordersData.map(o => new Date(o.created_at))))
          : null
        const daysSinceLastOrder = lastOrderDate
          ? Math.floor((Date.now() - lastOrderDate.getTime()) / 86400000)
          : null

        const activeOrders = (ordersData || []).filter(o => {
          const st = (o.status || '').toLowerCase()
          return st !== 'cancelled' && st !== 'in_completed' && st !== 'in_delivered'
        })
        const pendingPaymentOrders = activeOrders.filter(o => {
          const ps = (o.payment_status || '').toLowerCase()
          return ps === 'credito' || ps === 'parcial' || ps === 'pending_payment'
        })
        const pendingPaymentPct = activeOrders.length > 0
          ? Math.round(pendingPaymentOrders.length / activeOrders.length * 1000) / 10
          : 0

        let clientsRegistered = 0
        try {
          const { count } = await supabase.from('clients')
            .select('id', { count: 'exact', head: true })
            .eq('created_by', seller_id)
            .gte('created_at', date_from || '1970-01-01')
            .lt('created_at', date_to || new Date().toISOString())
          clientsRegistered = count || 0
        } catch { /* ignore */ }

        result = {
          top_clients,
          materials,
          order_frequency: {
            per_day: totalOrders > 0 ? Math.round(totalOrders / days * 100) / 100 : 0,
            per_week: totalOrders > 0 ? Math.round(totalOrders / (days / 7) * 100) / 100 : 0,
            per_month: totalOrders > 0 ? Math.round(totalOrders / (days / 30) * 100) / 100 : 0,
          },
          days_since_last_order: daysSinceLastOrder,
          pending_payment_pct: pendingPaymentPct,
          clients_registered: clientsRegistered,
        }
        break
      }

      case 'seller_activity': {
        const { seller_id, offset = 0, limit = 10 } = body
        if (!seller_id) return { status: 400, body: { error: 'seller_id es requerido' } }

        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: orderEvents } = await supabase
          .from('order_events')
          .select(`
            id, event_type, old_status, new_status,
            old_payment_status, new_payment_status,
            changes, created_at,
            order_id,
            orders!inner (id, client_name, order_type, seller_id, created_by)
          `)
          .or(`orders.seller_id.eq.${seller_id},orders.created_by.eq.${seller_id}`)
          .gte('created_at', from)
          .lt('created_at', to)
          .order('created_at', { ascending: false })

        const { data: clientEvents } = await supabase
          .from('clients')
          .select('id, name, created_at')
          .eq('created_by', seller_id)
          .gte('created_at', from)
          .lt('created_at', to)

        const events = [
          ...(orderEvents || []).map(e => ({
            id: e.id,
            type: e.event_type,
            order_id: e.order_id,
            order_client: e.orders?.client_name,
            order_type: e.orders?.order_type,
            old_status: e.old_status,
            new_status: e.new_status,
            old_payment: e.old_payment_status,
            new_payment: e.new_payment_status,
            changes: e.changes,
            created_at: e.created_at,
            source: 'order',
          })),
          ...(clientEvents || []).map(c => ({
            id: c.id,
            type: 'client_created',
            client_name: c.name,
            created_at: c.created_at,
            source: 'client',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = events.length
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      case 'seller_metrics': {
        const { metric = 'orders' } = body
        const { data, error } = await supabase.rpc('kpi_seller_metrics', {
          p_metric: metric,
          p_date_from: date_from,
          p_date_to: date_to,
        })
        if (error) throw error
        result = data
        break
      }

      case 'sla_violations': {
        const { data, error } = await supabase.rpc('kpi_sla_violations')
        if (error) throw error
        result = data
        break
      }

      case 'payment_summary': {
        const now = new Date()
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

        const [credito, parcial, pendingPayment, pendingAged] = await Promise.all([
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'credito').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'parcial').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'Pending_Payment').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id, client_name, created_at').eq('payment_status', 'Pending_Payment').not('status', 'in', '(cancelled,in_completed,in_delivered)').lt('created_at', threeDaysAgo.toISOString()).order('created_at', { ascending: true }),
        ])

        if (credito.error) console.error('credito:', credito.error.message)
        if (parcial.error) console.error('parcial:', parcial.error.message)
        if (pendingPayment.error) console.error('pendingPayment:', pendingPayment.error.message)
        if (pendingAged.error) console.error('pendingAged:', pendingAged.error.message)

        const agedOrders = (pendingAged.data || []).map(o => ({
          id: o.id,
          client_name: o.client_name,
          days_pending: (now - new Date(o.created_at)) / (1000 * 60 * 60 * 24),
        }))

        const paymentByClientRaw = await supabase.from('orders')
          .select('client_id, client_name, payment_status, price, id, created_at, invoice_number')
          .in('payment_status', ['credito', 'parcial'])
          .not('status', 'in', '(cancelled,in_completed,in_delivered)')

        if (paymentByClientRaw.error) console.error('paymentByClient:', paymentByClientRaw.error.message)

        const byClientMap = {}
        ;(paymentByClientRaw.data || []).forEach(o => {
          if (!o.client_id) return
          if (!byClientMap[o.client_id]) {
            byClientMap[o.client_id] = {
              client_id: o.client_id,
              client_name: o.client_name,
              credito_count: 0,
              parcial_count: 0,
              total_pending: 0,
              orders: [],
            }
          }
          if (o.payment_status === 'credito') byClientMap[o.client_id].credito_count++
          if (o.payment_status === 'parcial') byClientMap[o.client_id].parcial_count++
          const price = parseFloat(o.price) || 0
          byClientMap[o.client_id].total_pending += price
          byClientMap[o.client_id].orders.push({
            id: o.id,
            price,
            payment_status: o.payment_status,
            created_at: o.created_at,
            invoice_number: o.invoice_number || '',
          })
        })

        result = {
          credito: credito.count || 0,
          parcial: parcial.count || 0,
          pending_payment: pendingPayment.count || 0,
          pending_payment_aged: {
            count: agedOrders.length,
            orders: agedOrders,
          },
          by_client: Object.values(byClientMap)
            .filter(c => c.credito_count + c.parcial_count > 0)
            .sort((a, b) => b.total_pending - a.total_pending),
        }
        break
      }

      case 'order_counts': {
        const mkBase = () => supabase.from('orders').select('id', { count: 'exact', head: true })
        const mkActive = () => mkBase().not('status', 'in', '(cancelled,in_completed,in_delivered)')

        const [
          all, internal, external, normal, urgent911,
          internalNormal, internal911, externalNormal, external911,
          payPending, payPartial, payPaid, payCredit,
          wfPending, wfDesign, wfQuote, wfProduction, wfTermination, wfCompleted, wfDelivered,
          opActive, opBlocked,
        ] = await Promise.all([
          mkBase(),
          mkActive().eq('order_design_type', 'INTERNAL_DESING'),
          mkActive().eq('order_design_type', 'EXTERNAL_DESING'),
          mkActive().eq('order_type', 'orden normal'),
          mkActive().eq('order_type', 'orden 911'),
          mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden normal'),
          mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden 911'),
          mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden normal'),
          mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden 911'),
          mkActive().eq('payment_status', 'Pending_Payment'),
          mkActive().eq('payment_status', 'parcial'),
          mkActive().eq('payment_status', 'pagado'),
          mkActive().eq('payment_status', 'credito'),
          mkActive().eq('status', 'Pending'),
          mkActive().eq('status', 'in_Design'),
          mkActive().eq('status', 'in_Quote'),
          mkActive().eq('status', 'in_Production'),
          mkActive().eq('status', 'in_Termination'),
          mkActive().eq('status', 'in_Completed'),
          mkActive().eq('status', 'in_Delivered'),
          mkActive().eq('operational_status', 'active'),
          mkActive().eq('operational_status', 'blocked'),
        ])

        result = {
          totals: {
            all: all.count || 0,
            internal: internal.count || 0,
            external: external.count || 0,
            normal: normal.count || 0,
            urgent_911: urgent911.count || 0,
          },
          combinations: {
            internal_normal: internalNormal.count || 0,
            internal_911: internal911.count || 0,
            external_normal: externalNormal.count || 0,
            external_911: external911.count || 0,
          },
          payment: {
            pending: payPending.count || 0,
            partial: payPartial.count || 0,
            paid: payPaid.count || 0,
            credit: payCredit.count || 0,
          },
          workflow: {
            pending: wfPending.count || 0,
            design: wfDesign.count || 0,
            quote: wfQuote.count || 0,
            production: wfProduction.count || 0,
            termination: wfTermination.count || 0,
            completed: wfCompleted.count || 0,
            delivered: wfDelivered.count || 0,
          },
          operational: {
            active: opActive.count || 0,
            blocked: opBlocked.count || 0,
          },
        }
        break
      }

      // ─── Design Intelligence ────────────────────────────────────────────────

      case 'design_overview': {
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: designOrders }, { data: designers }, { count: totalDesigners }] = await Promise.all([
          supabase.from('orders')
            .select('id, designer_id, status, order_design_type, return_reason, status_changed_at, created_at, client_name, material, order_type', { count: 'exact' })
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id, name').eq('role', 'designer'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'designer'),
        ])

        const orders = designOrders || []
        const designerList = designers || []
        const activeDesignerIds = new Set(orders.filter(o => ['in_Design', 'in_Quote', 'in_Production', 'in_Termination'].includes(o.status)).map(o => o.designer_id).filter(Boolean))

        const total = orders.length
        const completed = orders.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
        const inDesign = orders.filter(o => o.status === 'in_Design').length
        const pending = orders.filter(o => o.status === 'Pending').length
        const returned = orders.filter(o => o.return_reason).length
        const cancelled = orders.filter(o => o.status === 'cancelled').length

        const completedOrders = orders.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
        const avgDays = completedOrders.length > 0
          ? completedOrders.reduce((sum, o) => {
              const created = new Date(o.created_at)
              const changed = new Date(o.status_changed_at)
              return sum + (changed - created) / 86400000
            }, 0) / completedOrders.length
          : 0

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrders } = await supabase.from('orders')
            .select('id, status, return_reason, status_changed_at, created_at')
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', compare_from).lt('created_at', compare_to)

          const prev = prevOrders || []
          const prevCompleted = prev.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
          const prevReturned = prev.filter(o => o.return_reason).length
          const prevCompletedOrders = prev.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
          const prevAvgDays = prevCompletedOrders.length > 0
            ? prevCompletedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / prevCompletedOrders.length
            : 0

          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100

          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            completed: { prev: prevCompleted, curr: completed, change_pct: safePct(completed, prevCompleted) },
            returned: { prev: prevReturned, curr: returned, change_pct: safePct(returned, prevReturned) },
            avg_days: { prev: +prevAvgDays.toFixed(1), curr: +avgDays.toFixed(1), change_pct: safePct(avgDays, prevAvgDays) },
          }
        }

        const alerts = []
        if (total > 0 && returned / total > 0.15) alerts.push({ type: 'high_return', title: 'Alta tasa de devolución', message: `${((returned / total) * 100).toFixed(0)}% de órdenes devueltas`, severity: 'critical' })
        if (inDesign > 5) alerts.push({ type: 'design_bottleneck', title: 'Cuello de botella en diseño', message: `${inDesign} órdenes en proceso de diseño`, severity: 'warning' })
        if (pending > 3) alerts.push({ type: 'pending_orders', title: 'Órdenes pendientes', message: `${pending} órdenes esperando ser asignadas`, severity: 'warning' })

        const statusBreakdown = { pending, in_design: inDesign, in_quote: orders.filter(o => o.status === 'in_Quote').length, in_production: orders.filter(o => o.status === 'in_Production').length, in_termination: orders.filter(o => o.status === 'in_Termination').length, completed: orders.filter(o => o.status === 'in_Completed').length, delivered: orders.filter(o => o.status === 'in_Delivered').length, cancelled }

        result = {
          summary: {
            total_orders: total, completed_orders: completed, in_design: inDesign, pending_orders: pending, returned_orders: returned, cancelled_orders: cancelled,
            completion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            return_rate: total > 0 ? +((returned / total) * 100).toFixed(1) : 0,
            avg_design_days: +avgDays.toFixed(1),
            total_designers: totalDesigners || 0,
            active_designers: activeDesignerIds.size,
          },
          status_breakdown: statusBreakdown,
          designers: designerList,
          alerts,
          comparison: cmp,
        }
        break
      }

      case 'designer_metrics': {
        const { metric = 'orders' } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: designers } = await supabase.from('profiles').select('id, name').eq('role', 'designer')
        const designerList = designers || []

        let values = []
        if (metric === 'files') {
          const { data: files } = await supabase.from('order_production_files')
            .select('created_by').gte('created_at', from).lt('created_at', to)
          const countByDesigner = {}
          ;(files || []).forEach(f => { if (f.created_by) countByDesigner[f.created_by] = (countByDesigner[f.created_by] || 0) + 1 })
          values = designerList.map(d => ({ id: d.id, name: d.name, value: countByDesigner[d.id] || 0 }))
        } else if (metric === 'avg_time') {
          const { data: orders } = await supabase.from('orders')
            .select('designer_id, status_changed_at, created_at')
            .eq('order_design_type', 'INTERNAL_DESING')
            .not('designer_id', 'is', null)
            .gte('created_at', from).lt('created_at', to)
          const timeByDesigner = {}
          const countByDesigner = {}
          ;(orders || []).forEach(o => {
            if (o.designer_id && o.status_changed_at) {
              const days = (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000
              timeByDesigner[o.designer_id] = (timeByDesigner[o.designer_id] || 0) + days
              countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            }
          })
          values = designerList.map(d => ({ id: d.id, name: d.name, value: countByDesigner[d.id] ? +(timeByDesigner[d.id] / countByDesigner[d.id]).toFixed(1) : 0 }))
        } else {
          const statusMap = { orders: null, completed: ['in_Completed', 'in_Delivered'], in_design: ['in_Design'], returned: null }
          const { data: orders } = await supabase.from('orders')
            .select('designer_id, status, return_reason')
            .eq('order_design_type', 'INTERNAL_DESING')
            .not('designer_id', 'is', null)
            .gte('created_at', from).lt('created_at', to)

          const countByDesigner = {}
          ;(orders || []).forEach(o => {
            if (!o.designer_id) return
            if (metric === 'returned') {
              if (o.return_reason) countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            } else if (statusMap[metric]) {
              if (statusMap[metric].includes(o.status)) countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            } else {
              countByDesigner[o.designer_id] = (countByDesigner[o.designer_id] || 0) + 1
            }
          })
          values = designerList.map(d => ({ id: d.id, name: d.name, value: countByDesigner[d.id] || 0 }))
        }

        const total = values.reduce((s, v) => s + v.value, 0)
        values.sort((a, b) => b.value - a.value)
        values.forEach((v, i) => {
          v.pct = total > 0 ? +((v.value / total) * 100).toFixed(1) : 0
          v.rank = i + 1
        })

        const metricLabels = { orders: 'Órdenes Totales', completed: 'Completadas', in_design: 'En Diseño', returned: 'Devueltas', files: 'Archivos Subidos', avg_time: 'Tiempo Prom. (días)' }
        result = { metric, metric_label: metricLabels[metric] || metric, total, designers: values }
        break
      }

      case 'designer_daily_trend': {
        const { metric = 'orders' } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: designers } = await supabase.from('profiles').select('id, name').eq('role', 'designer')
        const designerMap = {}
        ;(designers || []).forEach(d => { designerMap[d.id] = d.name })

        const trend = []
        if (metric === 'files') {
          const { data: files } = await supabase.from('order_production_files')
            .select('created_by, created_at').gte('created_at', from).lt('created_at', to)
          const byDateDesigner = {}
          ;(files || []).forEach(f => {
            if (!f.created_by || !designerMap[f.created_by]) return
            const day = f.created_at.slice(0, 10)
            const key = `${day}_${f.created_by}`
            byDateDesigner[key] = (byDateDesigner[key] || 0) + 1
          })
          Object.entries(byDateDesigner).forEach(([key, value]) => {
            const [date, designer_id] = key.split('_')
            trend.push({ date, designer_id, designer_name: designerMap[designer_id], value })
          })
        } else {
          const { data: orders } = await supabase.from('orders')
            .select('designer_id, status, return_reason, created_at')
            .eq('order_design_type', 'INTERNAL_DESING')
            .not('designer_id', 'is', null)
            .gte('created_at', from).lt('created_at', to)

          const byDateDesigner = {}
          ;(orders || []).forEach(o => {
            if (!designerMap[o.designer_id]) return
            const day = o.created_at.slice(0, 10)
            const key = `${day}_${o.designer_id}`
            let count = false
            if (metric === 'orders') count = true
            else if (metric === 'completed' && ['in_Completed', 'in_Delivered'].includes(o.status)) count = true
            else if (metric === 'in_design' && o.status === 'in_Design') count = true
            else if (metric === 'returned' && o.return_reason) count = true
            if (count) byDateDesigner[key] = (byDateDesigner[key] || 0) + 1
          })
          Object.entries(byDateDesigner).forEach(([key, value]) => {
            const [date, designer_id] = key.split('_')
            trend.push({ date, designer_id, designer_name: designerMap[designer_id], value })
          })
        }

        trend.sort((a, b) => a.date.localeCompare(b.date) || a.designer_id.localeCompare(b.designer_id))
        const metricLabels = { orders: 'Órdenes Totales', completed: 'Completadas', in_design: 'En Diseño', returned: 'Devueltas', files: 'Archivos Subidos' }
        result = { metric, metric_label: metricLabels[metric] || metric, trend }
        break
      }

      case 'designer_detail': {
        const { designer_id } = body
        if (!designer_id) return { status: 400, body: { error: 'designer_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: designer }, { data: orders }, { count: totalAll }, { count: designerCount }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', designer_id).single(),
          supabase.from('orders')
            .select('id, status, return_reason, order_design_type, order_type, client_name, material, status_changed_at, created_at')
            .eq('designer_id', designer_id)
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('orders').select('id', { count: 'exact', head: true })
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'designer'),
        ])

        const ords = orders || []
        const total = ords.length
        const completed = ords.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
        const inDesign = ords.filter(o => o.status === 'in_Design').length
        const pending = ords.filter(o => o.status === 'Pending').length
        const returned = ords.filter(o => o.return_reason).length
        const cancelled = ords.filter(o => o.status === 'cancelled').length
        const inQuote = ords.filter(o => o.status === 'in_Quote').length
        const inProduction = ords.filter(o => o.status === 'in_Production').length
        const delivered = ords.filter(o => o.status === 'in_Delivered').length

        const completedOrders = ords.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
        const avgDays = completedOrders.length > 0
          ? completedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / completedOrders.length
          : 0

        const normal = ords.filter(o => o.order_type !== 'orden 911').length
        const urgent = ords.filter(o => o.order_type === 'orden 911').length

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrders } = await supabase.from('orders')
            .select('id, status, return_reason, status_changed_at, created_at')
            .eq('designer_id', designer_id)
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', compare_from).lt('created_at', compare_to)

          const prev = prevOrders || []
          const prevCompleted = prev.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
          const prevReturned = prev.filter(o => o.return_reason).length
          const prevCompletedOrders = prev.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
          const prevAvgDays = prevCompletedOrders.length > 0
            ? prevCompletedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / prevCompletedOrders.length
            : 0

          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            completed: { prev: prevCompleted, curr: completed, change_pct: safePct(completed, prevCompleted) },
            returned: { prev: prevReturned, curr: returned, change_pct: safePct(returned, prevReturned) },
            avg_days: { prev: +prevAvgDays.toFixed(1), curr: +avgDays.toFixed(1), change_pct: safePct(avgDays, prevAvgDays) },
          }
        }

        const vsDept = {
          orders_vs_avg: totalAll > 0 && (designerCount || 1) > 0
            ? +((total / (totalAll / (designerCount || 1)) - 1) * 100).toFixed(1)
            : 0,
        }

        result = {
          designer: designer || { id: designer_id, name: 'Desconocido' },
          orders: { total, normal, urgent, completed, cancelled, pending, in_design: inDesign, in_quote: inQuote, in_production: inProduction, delivered, returned },
          rates: {
            completion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            return_rate: total > 0 ? +((returned / total) * 100).toFixed(1) : 0,
            avg_design_days: +avgDays.toFixed(1),
          },
          vs_department: vsDept,
          comparison: cmp,
        }
        break
      }

      case 'designer_profile': {
        const { designer_id } = body
        if (!designer_id) return { status: 400, body: { error: 'designer_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: orders }, { data: files }] = await Promise.all([
          supabase.from('orders')
            .select('id, client_id, client_name, material, status, created_at, status_changed_at')
            .eq('designer_id', designer_id)
            .eq('order_design_type', 'INTERNAL_DESING')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_production_files')
            .select('id, production_area_code, created_at, started_at, completed_at')
            .eq('created_by', designer_id)
            .gte('created_at', from).lt('created_at', to),
        ])

        const ords = orders || []
        const fils = files || []

        const clientCount = {}
        ords.forEach(o => {
          if (!o.client_name) return
          if (!clientCount[o.client_name]) clientCount[o.client_name] = { total: 0, completed: 0, cancelled: 0 }
          clientCount[o.client_name].total++
          if (['in_Completed', 'in_Delivered'].includes(o.status)) clientCount[o.client_name].completed++
          if (o.status === 'cancelled') clientCount[o.client_name].cancelled++
        })
        const topClients = Object.entries(clientCount)
          .map(([client_name, data]) => ({ client_name, total_orders: data.total, completed_orders: data.completed, cancel_rate: data.total > 0 ? Math.round(data.cancelled / data.total * 1000) / 10 : 0 }))
          .sort((a, b) => b.total_orders - a.total_orders).slice(0, 10)

        const materialCount = {}
        ords.forEach(o => { if (o.material) materialCount[o.material] = (materialCount[o.material] || 0) + 1 })
        const materials = Object.entries(materialCount)
          .map(([name, count]) => ({ name, count, pct: ords.length > 0 ? +((count / ords.length) * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count).slice(0, 10)

        const filesByArea = {}
        fils.forEach(f => { if (f.production_area_code) filesByArea[f.production_area_code] = (filesByArea[f.production_area_code] || 0) + 1 })

        const perDay = ords.length
        const daysSpan = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const orderFrequency = { per_day: +(perDay / daysSpan).toFixed(1), per_week: +((perDay / daysSpan) * 7).toFixed(1), per_month: +((perDay / daysSpan) * 30).toFixed(1) }

        let daysSinceLast = null
        if (ords.length > 0) {
          const lastDate = ords.reduce((max, o) => new Date(o.created_at) > new Date(max) ? o.created_at : max, ords[0].created_at)
          daysSinceLast = Math.floor((new Date() - new Date(lastDate)) / 86400000)
        }

        const avgFilesPerOrder = ords.length > 0 ? +(fils.length / ords.length).toFixed(1) : 0

        result = { top_clients: topClients, materials, order_frequency: orderFrequency, days_since_last_order: daysSinceLast, files_by_area: filesByArea, avg_files_per_order: avgFilesPerOrder, total_files: fils.length }
        break
      }

      case 'designer_activity': {
        const { designer_id, offset = 0, limit = 10 } = body
        if (!designer_id) return { status: 400, body: { error: 'designer_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: orderEvents }, { data: files }, { data: clientEvents }] = await Promise.all([
          supabase.from('order_events')
            .select('id, event_type, old_status, new_status, old_payment_status, new_payment_status, changes, created_at, order_id, orders!inner (id, client_name, order_type, designer_id, created_by)')
            .or(`orders.designer_id.eq.${designer_id},orders.created_by.eq.${designer_id}`)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('order_production_files')
            .select('id, order_id, filename, production_area_code, created_at')
            .eq('created_by', designer_id)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('clients')
            .select('id, name, created_at')
            .eq('created_by', designer_id)
            .gte('created_at', from).lt('created_at', to),
        ])

        const events = [
          ...(orderEvents || []).map(e => ({
            id: e.id, type: e.event_type, order_id: e.order_id,
            order_client: e.orders?.client_name, order_type: e.orders?.order_type,
            old_status: e.old_status, new_status: e.new_status,
            old_payment: e.old_payment_status, new_payment: e.new_payment_status,
            changes: e.changes, created_at: e.created_at, source: 'order',
          })),
          ...(files || []).map(f => ({
            id: f.id, type: 'design_file_added', order_id: f.order_id,
            filename: f.filename, production_area_code: f.production_area_code,
            created_at: f.created_at, source: 'file',
          })),
          ...(clientEvents || []).map(c => ({
            id: c.id, type: 'client_created', client_name: c.name,
            created_at: c.created_at, source: 'client',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = events.length
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      case 'quote_metrics': {
        const { metric = 'orders' } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: quotes }, { data: orders }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('role', 'quote').eq('employment_status', true),
          supabase.from('orders').select('id, quote_id, status, status_changed_at, payment_status, created_at')
            .not('quote_id', 'is', null)
            .gte('created_at', from).lt('created_at', to),
        ])

        const quoteList = quotes || []
        const ords = orders || []
        const total = ords.length

        const quoteMap = {}
        quoteList.forEach(q => { quoteMap[q.id] = q.name })

        const computeQuoteMetric = (qId, m) => {
          const userOrds = ords.filter(o => o.quote_id === qId)
          switch (m) {
            case 'completed':
              return userOrds.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
            case 'partial_payment':
              return userOrds.filter(o => o.payment_status === 'parcial').length
            case 'credit':
              return userOrds.filter(o => o.payment_status === 'credito').length
            case 'pending':
              return userOrds.filter(o => o.payment_status === 'Pending_Payment').length
            case 'converted': {
              const completed = userOrds.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
              return userOrds.length > 0 ? +((completed / userOrds.length) * 100).toFixed(1) : 0
            }
            case 'avg_time': {
              const done = userOrds.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
              return done.length > 0
                ? +(done.reduce((s, o) => s + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / done.length).toFixed(1)
                : 0
            }
            default:
              return userOrds.length
          }
        }

        const metricLabels = { orders: 'Órdenes Asignadas', completed: 'Completadas', converted: 'Conversión %', avg_time: 'Tiempo Prom. (días)', partial_payment: 'Pago Parcial', credit: 'Crédito', pending: 'Pendientes de Pago' }
        const enriched = quoteList
          .map(q => ({ id: q.id, name: q.name, value: computeQuoteMetric(q.id, metric) }))
          .filter(q => q.value > 0 || metric === 'orders')
          .sort((a, b) => b.value - a.value)

        const maxVal = enriched.length > 0 ? enriched[0].value : 1
        enriched.forEach((q, i) => {
          q.rank = i + 1
          q.pct = total > 0 ? +((q.value / (['converted', 'avg_time'].includes(metric) ? Math.max(maxVal, 1) : ords.filter(o => o.quote_id === q.id).length || 1)) * 100).toFixed(1) : 0
          if (['converted', 'avg_time'].includes(metric)) {
            q.pct = enriched.length > 0 ? +((q.value / maxVal) * 100).toFixed(1) : 0
          }
        })

        result = { metric, metric_label: metricLabels[metric] || metric, total, quotes: enriched }
        break
      }

      case 'quote_detail': {
        const { quote_id } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: quoteUser }, { data: orders }, { count: totalAll }, { count: quoteCount }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', quote_id).single(),
          supabase.from('orders')
            .select('id, status, return_reason, order_type, client_name, material, payment_status, status_changed_at, created_at')
            .eq('quote_id', quote_id)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('orders').select('id', { count: 'exact', head: true })
            .not('quote_id', 'is', null)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'quote'),
        ])

        const ords = orders || []
        const total = ords.length
        const completed = ords.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
        const inQuote = ords.filter(o => o.status === 'in_Quote').length
        const pending = ords.filter(o => o.status === 'Pending').length
        const returned = ords.filter(o => o.return_reason).length
        const cancelled = ords.filter(o => o.status === 'cancelled').length
        const inProduction = ords.filter(o => o.status === 'in_Production').length
        const delivered = ords.filter(o => o.status === 'in_Delivered').length
        const normal = ords.filter(o => o.order_type !== 'orden 911').length
        const urgent = ords.filter(o => o.order_type === 'orden 911').length

        const paymentPaid = ords.filter(o => o.payment_status === 'pagado').length
        const paymentPartial = ords.filter(o => o.payment_status === 'parcial').length
        const paymentCredit = ords.filter(o => o.payment_status === 'credito').length
        const paymentPending = ords.filter(o => o.payment_status === 'Pending_Payment').length

        const completedOrders = ords.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
        const avgDays = completedOrders.length > 0
          ? completedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / completedOrders.length
          : 0

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrders } = await supabase.from('orders')
            .select('id, status, return_reason, payment_status, status_changed_at, created_at')
            .eq('quote_id', quote_id)
            .gte('created_at', compare_from).lt('created_at', compare_to)

          const prev = prevOrders || []
          const prevCompleted = prev.filter(o => ['in_Completed', 'in_Delivered'].includes(o.status)).length
          const prevCompletedOrders = prev.filter(o => o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status))
          const prevAvgDays = prevCompletedOrders.length > 0
            ? prevCompletedOrders.reduce((sum, o) => sum + (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000, 0) / prevCompletedOrders.length
            : 0
          const prevCancelled = prev.filter(o => o.status === 'cancelled').length
          const prevPaid = prev.filter(o => o.payment_status === 'pagado').length
          const prevPartial = prev.filter(o => o.payment_status === 'parcial').length
          const prevCredit = prev.filter(o => o.payment_status === 'credito').length
          const prevPendingPay = prev.filter(o => o.payment_status === 'Pending_Payment').length

          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            completed: { prev: prevCompleted, curr: completed, change_pct: safePct(completed, prevCompleted) },
            avg_days: { prev: +prevAvgDays.toFixed(1), curr: +avgDays.toFixed(1), change_pct: safePct(avgDays, prevAvgDays) },
            cancelled: { prev: prevCancelled, curr: cancelled, change_pct: safePct(cancelled, prevCancelled) },
            payment_paid: { prev: prevPaid, curr: paymentPaid, change_pct: safePct(paymentPaid, prevPaid) },
            payment_partial: { prev: prevPartial, curr: paymentPartial, change_pct: safePct(paymentPartial, prevPartial) },
            payment_credit: { prev: prevCredit, curr: paymentCredit, change_pct: safePct(paymentCredit, prevCredit) },
            payment_pending: { prev: prevPendingPay, curr: paymentPending, change_pct: safePct(paymentPending, prevPendingPay) },
          }
        }

        const vsDept = {
          orders_vs_avg: totalAll > 0 && (quoteCount || 1) > 0
            ? +((total / (totalAll / (quoteCount || 1)) - 1) * 100).toFixed(1)
            : 0,
        }

        result = {
          quote: quoteUser || { id: quote_id, name: 'Desconocido' },
          orders: { total, normal, urgent, completed, cancelled, pending, in_quote: inQuote, in_production: inProduction, delivered, returned },
          payment: {
            paid: paymentPaid,
            partial: paymentPartial,
            credit: paymentCredit,
            pending: paymentPending,
            conversion_rate: total > 0 ? +((paymentPaid / total) * 100).toFixed(1) : 0,
            outstanding: paymentPartial + paymentCredit + paymentPending,
          },
          rates: {
            conversion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            completion_rate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
            avg_quote_days: +avgDays.toFixed(1),
          },
          vs_department: vsDept,
          comparison: cmp,
        }
        break
      }

      case 'quote_profile': {
        const { quote_id } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: orders } = await supabase.from('orders')
          .select('id, client_id, client_name, material, status, created_at, status_changed_at, order_type')
          .eq('quote_id', quote_id)
          .gte('created_at', from).lt('created_at', to)

        const ords = orders || []

        const clientCount = {}
        ords.forEach(o => {
          if (!o.client_name) return
          if (!clientCount[o.client_name]) clientCount[o.client_name] = { total: 0, completed: 0, cancelled: 0 }
          clientCount[o.client_name].total++
          if (['in_Completed', 'in_Delivered'].includes(o.status)) clientCount[o.client_name].completed++
          if (o.status === 'cancelled') clientCount[o.client_name].cancelled++
        })
        const topClients = Object.entries(clientCount)
          .map(([client_name, data]) => ({ client_name, total_orders: data.total, completed_orders: data.completed, cancel_rate: data.total > 0 ? Math.round(data.cancelled / data.total * 1000) / 10 : 0 }))
          .sort((a, b) => b.total_orders - a.total_orders).slice(0, 10)

        const materialCount = {}
        ords.forEach(o => { if (o.material) materialCount[o.material] = (materialCount[o.material] || 0) + 1 })
        const materials = Object.entries(materialCount)
          .map(([name, count]) => ({ name, count, pct: ords.length > 0 ? +((count / ords.length) * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count).slice(0, 10)

        const perDay = ords.length
        const daysSpan = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const orderFrequency = { per_day: +(perDay / daysSpan).toFixed(1), per_week: +((perDay / daysSpan) * 7).toFixed(1), per_month: +((perDay / daysSpan) * 30).toFixed(1) }

        let daysSinceLast = null
        if (ords.length > 0) {
          const lastDate = ords.reduce((max, o) => new Date(o.created_at) > new Date(max) ? o.created_at : max, ords[0].created_at)
          daysSinceLast = Math.floor((new Date() - new Date(lastDate)) / 86400000)
        }

        const normal = ords.filter(o => o.order_type !== 'orden 911').length
        const urgent = ords.filter(o => o.order_type === 'orden 911').length

        result = { top_clients: topClients, materials, order_frequency: orderFrequency, days_since_last_order: daysSinceLast, quotes_by_type: { normal, urgent } }
        break
      }

      case 'quote_daily_trend': {
        const { quote_id, metric = 'orders' } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: quoteUser }, { data: orders }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', quote_id).single(),
          supabase.from('orders')
            .select('id, quote_id, status, status_changed_at, created_at')
            .eq('quote_id', quote_id)
            .gte('created_at', from).lt('created_at', to),
        ])

        const ords = orders || []
        const quoteName = quoteUser?.name || 'Desconocido'
        const dailyMap = {}

        ords.forEach(o => {
          const date = o.created_at?.slice(0, 10)
          if (!date) return
          const key = `${date}_${quote_id}`
          if (!dailyMap[key]) dailyMap[key] = { date, quote_id, quote_name: quoteName, count: 0, completed: 0, converted: 0, totalDays: 0, completedCount: 0 }

          dailyMap[key].count++
          if (['in_Completed', 'in_Delivered'].includes(o.status)) {
            dailyMap[key].completed++
            dailyMap[key].converted++
          }
          if (o.status_changed_at && ['in_Completed', 'in_Delivered'].includes(o.status)) {
            const days = (new Date(o.status_changed_at) - new Date(o.created_at)) / 86400000
            dailyMap[key].totalDays += days
            dailyMap[key].completedCount++
          }
        })

        const metricLabels = { orders: 'Órdenes Totales', completed: 'Completadas', converted: 'Conversión %', avg_time: 'Tiempo Prom. (días)' }
        const trend = Object.values(dailyMap).map(d => {
          let value = d.count
          if (metric === 'completed') value = d.completed
          else if (metric === 'converted') value = d.count > 0 ? +((d.completed / d.count) * 100).toFixed(1) : 0
          else if (metric === 'avg_time') value = d.completedCount > 0 ? +(d.totalDays / d.completedCount).toFixed(1) : 0
          return { date: d.date, quote_id: d.quote_id, quote_name: d.quote_name, value }
        }).sort((a, b) => a.date.localeCompare(b.date))

        result = { metric, metric_label: metricLabels[metric] || metric, trend }
        break
      }

      case 'quote_activity': {
        const { quote_id, offset = 0, limit = 10 } = body
        if (!quote_id) return { status: 400, body: { error: 'quote_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const fetchLimit = offset + limit + 50
        const [{ data: orderEvents, count: orderTotal }, { data: clientEvents, count: clientTotal }] = await Promise.all([
          supabase.from('order_events')
            .select('id, event_type, old_status, new_status, old_payment_status, new_payment_status, changes, created_at, order_id, orders!inner (id, client_name, order_type, quote_id, created_by)', { count: 'exact' })
            .eq('orders.quote_id', quote_id)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false })
            .range(0, Math.min(fetchLimit, 500) - 1),
          supabase.from('clients')
            .select('id, name, created_at', { count: 'exact' })
            .eq('created_by', quote_id)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false })
            .range(0, Math.min(fetchLimit, 100) - 1),
        ])

        const events = [
          ...(orderEvents || []).map(e => ({
            id: e.id, type: e.event_type, order_id: e.order_id,
            order_client: e.orders?.client_name, order_type: e.orders?.order_type,
            old_status: e.old_status, new_status: e.new_status,
            old_payment: e.old_payment_status, new_payment: e.new_payment_status,
            changes: e.changes, created_at: e.created_at, source: 'order',
          })),
          ...(clientEvents || []).map(c => ({
            id: c.id, type: 'client_created', client_name: c.name,
            created_at: c.created_at, source: 'client',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = (orderTotal || 0) + (clientTotal || 0)
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      // ═══════════════════════════════════════════════════════
      // PRODUCTION INTELLIGENCE
      // ═══════════════════════════════════════════════════════

      case 'production_overview': {
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: areas }, { data: allFiles }, { data: assignments }] = await Promise.all([
          supabase.from('production_areas').select('code, label, producer_role').eq('is_active', true),
          supabase.from('order_production_files')
            .select('id, order_id, production_area_code, status, assigned_to, created_by, started_at, in_termination_at, completed_at, created_at')
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_production_assignments')
            .select('order_id, production_area_code, assigned_to'),
        ])

        const areaList = areas || []
        const files = allFiles || []
        const assignList = assignments || []
        const totalFiles = files.length
        const totalCompleted = files.filter(f => f.status === 'completed').length

        const areaMetrics = areaList.map(area => {
          const areaFiles = files.filter(f => f.production_area_code === area.code)
          const completed = areaFiles.filter(f => f.status === 'completed')
          const times = completed
            .filter(f => f.started_at && f.completed_at)
            .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
          const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
          const reversions = areaFiles.filter(f => f.status === 'in_production' && f.in_termination_at).length
          const assignedUsers = new Set(
            assignList.filter(a => a.production_area_code === area.code).map(a => a.assigned_to)
          )

          return {
            code: area.code,
            label: area.label,
            total_files: areaFiles.length,
            completed: completed.length,
            in_production: areaFiles.filter(f => f.status === 'in_production').length,
            in_termination: areaFiles.filter(f => f.status === 'in_termination').length,
            pending: areaFiles.filter(f => f.status === 'pending').length,
            completion_rate: areaFiles.length > 0 ? +((completed.length / areaFiles.length) * 100).toFixed(1) : 0,
            avg_time_days: +avgTime.toFixed(1),
            reversions,
            reversion_rate: areaFiles.length > 0 ? +((reversions / areaFiles.length) * 100).toFixed(1) : 0,
            active_employees: assignedUsers.size,
            pct_of_total: totalFiles > 0 ? +((areaFiles.length / totalFiles) * 100).toFixed(1) : 0,
          }
        })

        const dailyMap = {}
        files.forEach(f => {
          const day = f.created_at.slice(0, 10)
          if (!dailyMap[day]) dailyMap[day] = {}
          const area = f.production_area_code || 'unknown'
          dailyMap[day][area] = (dailyMap[day][area] || 0) + 1
        })
        const trend = Object.entries(dailyMap).map(([date, areas]) => ({ date, ...areas })).sort((a, b) => a.date.localeCompare(b.date))

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevFiles } = await supabase.from('order_production_files')
            .select('id, production_area_code, status')
            .gte('created_at', compare_from).lt('created_at', compare_to)
          const prev = prevFiles || []
          const prevCompleted = prev.filter(f => f.status === 'completed').length
          const prevTotal = prev.length
          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total_files: { prev: prevTotal, curr: totalFiles, change_pct: safePct(totalFiles, prevTotal) },
            completed: { prev: prevCompleted, curr: totalCompleted, change_pct: safePct(totalCompleted, prevCompleted) },
          }
        }

        result = { areas: areaMetrics, trend, total_files: totalFiles, total_completed: totalCompleted, comparison: cmp }
        break
      }

      case 'production_area_detail': {
        const { area_code } = body
        if (!area_code) return { status: 400, body: { error: 'area_code es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: areaInfo }, { data: areaFiles }, { data: assignList }] = await Promise.all([
          supabase.from('production_areas').select('code, label, producer_role').eq('code', area_code).single(),
          supabase.from('order_production_files')
            .select('id, order_id, status, assigned_to, created_by, started_at, in_termination_at, completed_at, created_at')
            .eq('production_area_code', area_code)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_production_assignments')
            .select('order_id, assigned_to')
            .eq('production_area_code', area_code),
        ])

        const { data: profiles } = await supabase.from('profiles')
          .select('id, name').eq('role', areaInfo?.producer_role || 'admin')

        const files = areaFiles || []
        const assigns = assignList || []
        const profileList = profiles || []
        const profileMap = {}
        profileList.forEach(p => { profileMap[p.id] = p.name })

        const userMetrics = []
        const userIds = new Set(assigns.map(a => a.assigned_to).filter(Boolean))
        files.forEach(f => {
          if (f.assigned_to) userIds.add(f.assigned_to)
          if (f.created_by) userIds.add(f.created_by)
        })
        userIds.forEach(userId => {
          const userFiles = files.filter(f => f.assigned_to === userId || f.created_by === userId)
          const completed = userFiles.filter(f => f.status === 'completed')
          const times = completed
            .filter(f => f.started_at && f.completed_at)
            .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
          const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
          const reversions = userFiles.filter(f => f.status === 'in_production' && f.in_termination_at).length

          userMetrics.push({
            id: userId,
            name: profileMap[userId] || 'Desconocido',
            total_files: userFiles.length,
            completed: completed.length,
            in_production: userFiles.filter(f => f.status === 'in_production').length,
            in_termination: userFiles.filter(f => f.status === 'in_termination').length,
            avg_time_days: +avgTime.toFixed(1),
            reversions,
            reversion_rate: userFiles.length > 0 ? +((reversions / userFiles.length) * 100).toFixed(1) : 0,
          })
        })

        userMetrics.sort((a, b) => b.completed - a.completed)
        const topCompleted = userMetrics.length > 0 ? Math.max(userMetrics[0].completed, 1) : 1
        userMetrics.forEach((u, i) => {
          u.rank = i + 1
          u.pct = +((u.completed / topCompleted) * 100).toFixed(1)
        })

        const bottlenecks = files
          .filter(f => f.status === 'in_production' && f.started_at)
          .map(f => {
            const days = (new Date() - new Date(f.started_at)) / 86400000
            return { file_id: f.id, order_id: f.order_id, days_in_stage: +days.toFixed(1) }
          })
          .filter(b => b.days_in_stage > 3)
          .sort((a, b) => b.days_in_stage - a.days_in_stage)

        const completedFiles = files.filter(f => f.status === 'completed')
        const pendingFiles = files.filter(f => f.status === 'pending')
        const inProductionFiles = files.filter(f => f.status === 'in_production')
        const inTerminationFiles = files.filter(f => f.status === 'in_termination')
        const completedTimes = completedFiles
          .filter(f => f.started_at && f.completed_at)
          .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
        const avgTime = completedTimes.length > 0 ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length : 0
        const reversions = files.filter(f => f.status === 'in_production' && f.in_termination_at).length

        const dailyMap = {}
        files.forEach(f => {
          const day = (f.completed_at || f.created_at || '').slice(0, 10)
          if (!day) return
          if (!dailyMap[day]) dailyMap[day] = { total: 0, completed: 0, in_production: 0, in_termination: 0, pending: 0 }
          dailyMap[day].total++
          if (f.status === 'completed') dailyMap[day].completed++
          if (f.status === 'in_production') dailyMap[day].in_production++
          if (f.status === 'in_termination') dailyMap[day].in_termination++
          if (f.status === 'pending') dailyMap[day].pending++
        })
        const trend = Object.entries(dailyMap).map(([date, values]) => ({ date, ...values })).sort((a, b) => a.date.localeCompare(b.date))

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevFiles } = await supabase.from('order_production_files')
            .select('id, status, started_at, in_termination_at, completed_at, created_at')
            .eq('production_area_code', area_code)
            .gte('created_at', compare_from).lt('created_at', compare_to)
          const prev = prevFiles || []
          const prevCompleted = prev.filter(f => f.status === 'completed')
          const prevTimes = prevCompleted
            .filter(f => f.started_at && f.completed_at)
            .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
          const prevAvgTime = prevTimes.length > 0 ? prevTimes.reduce((a, b) => a + b, 0) / prevTimes.length : 0
          const prevReversions = prev.filter(f => f.status === 'in_production' && f.in_termination_at).length
          const safePct = (curr, prevValue) => prevValue === 0 ? (curr > 0 ? 100 : 0) : ((curr - prevValue) / prevValue) * 100
          cmp = {
            total_files: { prev: prev.length, curr: files.length, change_pct: +safePct(files.length, prev.length).toFixed(1) },
            completed: { prev: prevCompleted.length, curr: completedFiles.length, change_pct: +safePct(completedFiles.length, prevCompleted.length).toFixed(1) },
            avg_time_days: { prev: +prevAvgTime.toFixed(1), curr: +avgTime.toFixed(1), change_pct: +safePct(avgTime, prevAvgTime).toFixed(1) },
            reversions: { prev: prevReversions, curr: reversions, change_pct: +safePct(reversions, prevReversions).toFixed(1) },
          }
        }

        result = {
          area: areaInfo || { code: area_code, label: area_code },
          total_files: files.length,
          completed: completedFiles.length,
          pending: pendingFiles.length,
          in_production: inProductionFiles.length,
          in_termination: inTerminationFiles.length,
          completion_rate: files.length > 0 ? +((completedFiles.length / files.length) * 100).toFixed(1) : 0,
          avg_time_days: +avgTime.toFixed(1),
          reversions,
          reversion_rate: files.length > 0 ? +((reversions / files.length) * 100).toFixed(1) : 0,
          status_breakdown: [
            { key: 'pending', name: 'Pendiente', value: pendingFiles.length, color: '#F59E0B' },
            { key: 'in_production', name: 'En Produccion', value: inProductionFiles.length, color: '#F97316' },
            { key: 'in_termination', name: 'En Terminacion', value: inTerminationFiles.length, color: '#0EA5E9' },
            { key: 'completed', name: 'Completado', value: completedFiles.length, color: '#10B981' },
          ],
          trend,
          comparison: cmp,
          users: userMetrics,
          bottlenecks,
        }
        break
      }

      case 'production_employee_detail': {
        const { employee_id } = body
        if (!employee_id) return { status: 400, body: { error: 'employee_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: profile }, { data: empFiles }] = await Promise.all([
          supabase.from('profiles').select('id, name, role').eq('id', employee_id).single(),
          supabase.from('order_production_files')
            .select('id, order_id, production_area_code, status, started_at, in_termination_at, completed_at, created_at')
            .or(`assigned_to.eq.${employee_id},created_by.eq.${employee_id}`)
            .gte('created_at', from).lt('created_at', to),
        ])

        const files = empFiles || []
        const completed = files.filter(f => f.status === 'completed')
        const times = completed
          .filter(f => f.started_at && f.completed_at)
          .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
        const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
        const reversions = files.filter(f => f.status === 'in_production' && f.in_termination_at).length

        const filesByArea = {}
        files.forEach(f => {
          const area = f.production_area_code || 'unknown'
          if (!filesByArea[area]) filesByArea[area] = { total: 0, completed: 0, in_production: 0, in_termination: 0 }
          filesByArea[area].total++
          if (f.status === 'completed') filesByArea[area].completed++
          if (f.status === 'in_production') filesByArea[area].in_production++
          if (f.status === 'in_termination') filesByArea[area].in_termination++
        })

        const dailyMap = {}
        files.forEach(f => {
          const day = f.created_at.slice(0, 10)
          if (!dailyMap[day]) dailyMap[day] = { total: 0, completed: 0 }
          dailyMap[day].total++
          if (f.status === 'completed') dailyMap[day].completed++
        })
        const trend = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date))

        result = {
          profile: profile || { id: employee_id, name: 'Desconocido' },
          total_files: files.length,
          completed: completed.length,
          in_production: files.filter(f => f.status === 'in_production').length,
          in_termination: files.filter(f => f.status === 'in_termination').length,
          pending: files.filter(f => f.status === 'pending').length,
          avg_time_days: +avgTime.toFixed(1),
          reversions,
          reversion_rate: files.length > 0 ? +((reversions / files.length) * 100).toFixed(1) : 0,
          files_by_area: filesByArea,
          trend,
        }
        break
      }

      case 'production_employee_ranking': {
        const { area_code: rankAreaCode = null } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: allProfiles }, { data: files }, { data: assigns }] = await Promise.all([
          supabase.from('profiles').select('id, name, role').in('role', ['digital_producer', 'dtf_producer', 'ploteo_producer']),
          (() => {
            let q = supabase.from('order_production_files')
              .select('id, production_area_code, status, assigned_to, created_by, started_at, completed_at, in_termination_at, created_at')
              .gte('created_at', from).lt('created_at', to)
            if (rankAreaCode) q = q.eq('production_area_code', rankAreaCode)
            return q
          })(),
          (() => {
            let q = supabase.from('order_production_assignments').select('order_id, production_area_code, assigned_to')
            if (rankAreaCode) q = q.eq('production_area_code', rankAreaCode)
            return q
          })(),
        ])

        const profileMap = {}
        ;(allProfiles || []).forEach(p => { profileMap[p.id] = { name: p.name, role: p.role } })

        const empMap = {}
        ;(assigns || []).forEach(a => {
          if (!empMap[a.assigned_to]) empMap[a.assigned_to] = { area: a.production_area_code }
        })
        ;(files || []).forEach(f => {
          const uid = f.assigned_to || f.created_by
          if (uid && !empMap[uid]) empMap[uid] = { area: f.production_area_code }
        })

        const ranking = Object.keys(empMap).map(userId => {
          const userFiles = (files || []).filter(f => (f.assigned_to === userId || f.created_by === userId))
          const completed = userFiles.filter(f => f.status === 'completed')
          const times = completed
            .filter(f => f.started_at && f.completed_at)
            .map(f => (new Date(f.completed_at) - new Date(f.started_at)) / 86400000)
          const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
          const reversions = userFiles.filter(f => f.status === 'in_production' && f.in_termination_at).length

          return {
            id: userId,
            name: profileMap[userId]?.name || 'Desconocido',
            area: empMap[userId]?.area || 'N/A',
            total_files: userFiles.length,
            completed: completed.length,
            avg_time_days: +avgTime.toFixed(1),
            reversions,
            reversion_rate: userFiles.length > 0 ? +((reversions / userFiles.length) * 100).toFixed(1) : 0,
            in_production: userFiles.filter(f => f.status === 'in_production').length,
          }
        }).filter(u => u.total_files > 0)

        ranking.sort((a, b) => b.completed - a.completed)
        ranking.forEach((u, i) => {
          u.rank = i + 1
          u.pct = ranking.length > 0 ? +((u.completed / Math.max(ranking[0].completed, 1)) * 100).toFixed(1) : 0
        })

        result = { users: ranking, total_users: ranking.length }
        break
      }

      case 'production_employee_activity': {
        const { employee_id: actEmpId } = body
        if (!actEmpId) return { status: 400, body: { error: 'employee_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()
        const offset = parseInt(body.offset || '0', 10)
        const limit = parseInt(body.limit || '20', 10)

        const [{ data: orderEvents }, { data: orderTotal }, { data: fileEvents }, { data: fileTotal }] = await Promise.all([
          supabase.from('order_events')
            .select('id, order_id, event_type, old_status, new_status, created_at, actor_id')
            .eq('actor_id', actEmpId)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('order_events')
            .select('id', { count: 'exact', head: true })
            .eq('actor_id', actEmpId)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_production_files')
            .select('id, order_id, status, production_area_code, created_at')
            .or(`assigned_to.eq.${actEmpId},created_by.eq.${actEmpId}`)
            .gte('created_at', from).lt('created_at', to)
            .order('created_at', { ascending: false }),
          supabase.from('order_production_files')
            .select('id', { count: 'exact', head: true })
            .or(`assigned_to.eq.${actEmpId},created_by.eq.${actEmpId}`)
            .gte('created_at', from).lt('created_at', to),
        ])

        const events = [
          ...(orderEvents || []).map(e => ({
            id: e.id, type: 'status_change', order_id: e.order_id,
            detail: `${e.old_status || '—'} → ${e.new_status || '—'}`,
            created_at: e.created_at, source: 'order',
          })),
          ...(fileEvents || []).map(f => ({
            id: f.id, type: 'file_update', order_id: f.order_id,
            detail: `Archivo ${f.status} (${f.production_area_code || 'N/A'})`,
            created_at: f.created_at, source: 'file',
          })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        const total = (orderTotal || 0) + (fileTotal || 0)
        result = { events: events.slice(offset, offset + limit), total }
        break
      }

      case 'production_daily_trend': {
        const { area_code: trendAreaCode = null } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        let q = supabase.from('order_production_files')
          .select('production_area_code, status, completed_at, created_at')
          .gte('created_at', from).lt('created_at', to)
        if (trendAreaCode) q = q.eq('production_area_code', trendAreaCode)

        const { data: files } = await q
        const dailyMap = {}
        ;(files || []).forEach(f => {
          const day = (f.completed_at || f.created_at).slice(0, 10)
          const area = f.production_area_code || 'unknown'
          if (!dailyMap[day]) dailyMap[day] = {}
          if (trendAreaCode) {
            if (!dailyMap[day].total) dailyMap[day].total = 0
            if (!dailyMap[day].completed) dailyMap[day].completed = 0
            if (!dailyMap[day].in_production) dailyMap[day].in_production = 0
            if (!dailyMap[day].in_termination) dailyMap[day].in_termination = 0
            if (!dailyMap[day].pending) dailyMap[day].pending = 0
            dailyMap[day].total++
            if (f.status === 'completed') dailyMap[day].completed++
            if (f.status === 'in_production') dailyMap[day].in_production++
            if (f.status === 'in_termination') dailyMap[day].in_termination++
            if (f.status === 'pending') dailyMap[day].pending++
          } else {
            dailyMap[day][area] = (dailyMap[day][area] || 0) + 1
          }
        })
        const trend = Object.entries(dailyMap).map(([date, areas]) => ({ date, ...areas })).sort((a, b) => a.date.localeCompare(b.date))

        result = { trend }
        break
      }

      // ═══════════════════════════════════════════════════════
      // DELIVERY INTELLIGENCE
      // ═══════════════════════════════════════════════════════

      case 'delivery_metrics': {
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: deliveryUsers }, { data: orders }, { data: events }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('role', 'delivery').eq('employment_status', true),
          supabase.from('orders')
            .select('id, delivery_id, status, delivery_date, completed_at, created_at, payment_status, client_name')
            .not('delivery_id', 'is', null)
            .in('status', ['in_Completed', 'in_Delivered', 'in_Termination'])
            .gte('created_at', from).lt('created_at', to),
          supabase.from('order_events')
            .select('order_id, old_status, new_status, created_at')
            .in('new_status', ['in_Delivered', 'in_Completed']),
        ])

        const userList = deliveryUsers || []
        const ords = orders || []
        const evts = events || []

        const users = userList.map(user => {
          const userOrds = ords.filter(o => o.delivery_id === user.id)
          const delivered = userOrds.filter(o => o.status === 'in_Delivered')

          const onTime = delivered.filter(o => {
            if (!o.delivery_date || !o.completed_at) return false
            return new Date(o.completed_at) <= new Date(o.delivery_date)
          }).length

          const deliveryTimes = delivered.map(o => {
            const deliverEvent = evts.find(e => e.order_id === o.id && e.new_status === 'in_Delivered')
            if (deliverEvent && o.completed_at) {
              return (new Date(deliverEvent.created_at) - new Date(o.completed_at)) / 86400000
            }
            return null
          }).filter(t => t !== null)

          const avgDeliveryTime = deliveryTimes.length > 0
            ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length : 0

          const pending = userOrds.filter(o => o.status === 'in_Completed' || o.status === 'in_Termination')

          return {
            id: user.id,
            name: user.name,
            total_delivered: delivered.length,
            on_time: onTime,
            on_time_rate: delivered.length > 0 ? +((onTime / delivered.length) * 100).toFixed(1) : 0,
            avg_delivery_time_days: +avgDeliveryTime.toFixed(1),
            pending_deliveries: pending.length,
            orders_total: userOrds.length,
            pct_of_total: ords.length > 0 ? +((delivered.length / ords.length) * 100).toFixed(1) : 0,
          }
        })

        users.sort((a, b) => b.total_delivered - a.total_delivered)
        users.forEach((u, i) => { u.rank = i + 1 })

        const totalDelivered = ords.filter(o => o.status === 'in_Delivered').length
        const totalPending = ords.filter(o => o.status === 'in_Completed' || o.status === 'in_Termination').length

        const dailyMap = {}
        ords.filter(o => o.status === 'in_Delivered').forEach(o => {
          const evt = evts.find(e => e.order_id === o.id && e.new_status === 'in_Delivered')
          if (evt) {
            const day = evt.created_at.slice(0, 10)
            dailyMap[day] = (dailyMap[day] || 0) + 1
          }
        })
        const trend = Object.entries(dailyMap).map(([date, count]) => ({ date, delivered: count })).sort((a, b) => a.date.localeCompare(b.date))

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrds } = await supabase.from('orders')
            .select('id, delivery_id, status, completed_at, delivery_date')
            .not('delivery_id', 'is', null)
            .in('status', ['in_Delivered'])
            .gte('created_at', compare_from).lt('created_at', compare_to)
          const prev = prevOrds || []
          const prevDelivered = prev.length
          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total_delivered: { prev: prevDelivered, curr: totalDelivered, change_pct: safePct(totalDelivered, prevDelivered) },
          }
        }

        result = { users, trend, total_delivered: totalDelivered, total_pending: totalPending, comparison: cmp }
        break
      }

      case 'delivery_detail': {
        const { delivery_user_id } = body
        if (!delivery_user_id) return { status: 400, body: { error: 'delivery_user_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const [{ data: profile }, { data: orders }, { count: totalAll }, { count: deliveryCount }] = await Promise.all([
          supabase.from('profiles').select('id, name').eq('id', delivery_user_id).single(),
          supabase.from('orders')
            .select('id, status, delivery_date, completed_at, created_at, payment_status, client_name, material, order_type')
            .eq('delivery_id', delivery_user_id)
            .gte('created_at', from).lt('created_at', to),
          supabase.from('orders').select('id', { count: 'exact', head: true })
            .not('delivery_id', 'is', null)
            .in('status', ['in_Delivered', 'in_Completed', 'in_Termination'])
            .gte('created_at', from).lt('created_at', to),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'delivery'),
        ])

        const orderIds = (orders || []).map(o => o.id)
        const { data: events } = orderIds.length > 0
          ? await supabase.from('order_events')
              .select('order_id, old_status, new_status, created_at')
              .in('order_id', orderIds)
              .in('new_status', ['in_Delivered', 'in_Completed'])
          : { data: [] }

        const ords = orders || []
        const evts = events || []
        const total = ords.length
        const delivered = ords.filter(o => o.status === 'in_Delivered')
        const pending = ords.filter(o => o.status === 'in_Completed' || o.status === 'in_Termination')

        const onTime = delivered.filter(o => {
          if (!o.delivery_date || !o.completed_at) return false
          return new Date(o.completed_at) <= new Date(o.delivery_date)
        }).length

        const deliveryTimes = delivered.map(o => {
          const evt = evts.find(e => e.order_id === o.id && e.new_status === 'in_Delivered')
          if (evt && o.completed_at) return (new Date(evt.created_at) - new Date(o.completed_at)) / 86400000
          return null
        }).filter(t => t !== null)
        const avgDeliveryTime = deliveryTimes.length > 0
          ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length : 0

        const paymentPaid = ords.filter(o => o.payment_status === 'pagado').length
        const paymentPartial = ords.filter(o => o.payment_status === 'parcial').length
        const paymentCredit = ords.filter(o => o.payment_status === 'credito').length
        const paymentPending = ords.filter(o => o.payment_status === 'Pending_Payment').length

        let cmp = null
        if (compare_from && compare_to) {
          const { data: prevOrds } = await supabase.from('orders')
            .select('id, status, completed_at, delivery_date')
            .eq('delivery_id', delivery_user_id)
            .gte('created_at', compare_from).lt('created_at', compare_to)
          const prev = prevOrds || []
          const prevDelivered = prev.filter(o => o.status === 'in_Delivered').length
          const safePct = (curr, prv) => prv === 0 ? (curr > 0 ? 100 : 0) : ((curr - prv) / prv) * 100
          cmp = {
            total: { prev: prev.length, curr: total, change_pct: safePct(total, prev.length) },
            delivered: { prev: prevDelivered, curr: delivered.length, change_pct: safePct(delivered.length, prevDelivered) },
          }
        }

        const vsTeam = {
          orders_vs_avg: totalAll > 0 && (deliveryCount || 1) > 0
            ? +((total / (totalAll / (deliveryCount || 1)) - 1) * 100).toFixed(1) : 0,
        }

        result = {
          profile: profile || { id: delivery_user_id, name: 'Desconocido' },
          orders: { total, delivered: delivered.length, pending: pending.length, on_time: onTime },
          rates: {
            on_time_rate: delivered.length > 0 ? +((onTime / delivered.length) * 100).toFixed(1) : 0,
            avg_delivery_time_days: +avgDeliveryTime.toFixed(1),
          },
          payment: { paid: paymentPaid, partial: paymentPartial, credit: paymentCredit, pending: paymentPending },
          vs_team: vsTeam,
          comparison: cmp,
        }
        break
      }

      case 'delivery_profile': {
        const { delivery_user_id: profUserId } = body
        if (!profUserId) return { status: 400, body: { error: 'delivery_user_id es requerido' } }
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        const { data: ords } = await supabase.from('orders')
          .select('id, client_name, material, status, created_at, completed_at, delivery_date')
          .eq('delivery_id', profUserId)
          .gte('created_at', from).lt('created_at', to)

        const orderList = ords || []

        const clientCount = {}
        orderList.forEach(o => {
          if (!o.client_name) return
          if (!clientCount[o.client_name]) clientCount[o.client_name] = { total: 0, delivered: 0 }
          clientCount[o.client_name].total++
          if (o.status === 'in_Delivered') clientCount[o.client_name].delivered++
        })
        const topClients = Object.entries(clientCount)
          .map(([client_name, data]) => ({ client_name, total_orders: data.total, delivered_orders: data.delivered }))
          .sort((a, b) => b.total_orders - a.total_orders).slice(0, 10)

        const materialCount = {}
        orderList.forEach(o => { if (o.material) materialCount[o.material] = (materialCount[o.material] || 0) + 1 })
        const materials = Object.entries(materialCount)
          .map(([name, count]) => ({ name, count, pct: orderList.length > 0 ? +((count / orderList.length) * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count).slice(0, 10)

        const daysSpan = Math.max(1, (new Date(to) - new Date(from)) / 86400000)
        const orderFrequency = {
          per_day: +(orderList.length / daysSpan).toFixed(1),
          per_week: +((orderList.length / daysSpan) * 7).toFixed(1),
          per_month: +((orderList.length / daysSpan) * 30).toFixed(1),
        }

        let daysSinceLast = null
        const sortedDates = orderList.map(o => new Date(o.created_at)).sort((a, b) => b - a)
        if (sortedDates.length > 0) {
          daysSinceLast = Math.floor((new Date() - sortedDates[0]) / 86400000)
        }

        result = {
          top_clients: topClients,
          materials,
          order_frequency: orderFrequency,
          days_since_last_order: daysSinceLast,
          total_orders: orderList.length,
        }
        break
      }

      case 'delivery_daily_trend': {
        const { delivery_user_id: trendDeliveryUserId = null } = body
        const from = date_from || '1970-01-01'
        const to = date_to || new Date().toISOString()

        let q = supabase.from('orders')
          .select('id, status, delivery_id, created_at')
          .not('delivery_id', 'is', null)
          .in('status', ['in_Delivered', 'in_Completed', 'in_Termination'])
          .gte('created_at', from).lt('created_at', to)
        if (trendDeliveryUserId) q = q.eq('delivery_id', trendDeliveryUserId)
        const { data: ords } = await q

        const dailyMap = {}
        ;(ords || []).forEach(o => {
          const day = o.created_at.slice(0, 10)
          if (!dailyMap[day]) dailyMap[day] = { delivered: 0, pending: 0 }
          if (o.status === 'in_Delivered') dailyMap[day].delivered++
          else dailyMap[day].pending++
        })

        const trend = Object.entries(dailyMap)
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date))

        result = { trend }
        break
      }

      case 'all': {
        const now = new Date()
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

        const [bs, oa, ca, ui, pi, sa, ot, sv, empCount, empCountAll, clientCount, credito, parcial, pendingPayment, pendingAged, materialsResult] = await Promise.all([
          supabase.rpc('kpi_business_summary', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_orders_analytics', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_client_analytics', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_user_analytics', { p_date_from: date_from, p_date_to: date_to }),
          supabase.rpc('kpi_production_insights', { p_date_from: date_from, p_date_to: date_to }),
          supabase.rpc('kpi_smart_alerts'),
          supabase.rpc('kpi_orders_trend', { p_days: 30 }),
          supabase.rpc('kpi_sla_violations'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('role', 'admin').eq('employment_status', true),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('role', 'admin'),
          supabase.from('clients').select('id', { count: 'exact', head: true }),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'credito').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'parcial').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'Pending_Payment').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id, created_at').not('status', 'in', '(cancelled,in_completed,in_delivered)').gte('created_at', threeDaysAgo.toISOString()),
          (() => {
            let q = supabase.from('orders').select('material, created_at').not('material', 'is', null)
            if (date_from) q = q.gte('created_at', date_from)
            if (date_to) q = q.lt('created_at', date_to)
            return q.then(({ data }) => {
              const counts = {}
              ;(data || []).forEach(o => {
                const raw = o.material || 'Sin material'
                const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
                if (parts.length === 0) {
                  counts['Sin material'] = (counts['Sin material'] || 0) + 1
                } else {
                  parts.forEach(m => {
                    counts[m] = (counts[m] || 0) + 1
                  })
                }
              })
              return { data: Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3) }
            })
          })(),
        ])

        if (bs.error) console.error('kpi_business_summary:', bs.error.message)
        if (oa.error) console.error('kpi_orders_analytics:', oa.error.message)
        if (ca.error) console.error('kpi_client_analytics:', ca.error.message)
        if (ui.error) console.error('kpi_user_analytics:', ui.error.message)
        if (pi.error) console.error('kpi_production_insights:', pi.error.message)
        if (sa.error) console.error('kpi_smart_alerts:', sa.error.message)
        if (ot.error) console.error('kpi_orders_trend:', ot.error.message)
        if (sv.error) console.error('kpi_sla_violations:', sv.error.message)
        if (empCount.error) console.error('total_employees:', empCount.error.message)
        if (empCountAll.error) console.error('total_employees_all:', empCountAll.error.message)
        if (clientCount.error) console.error('total_clients:', clientCount.error.message)

        const safeQuery = (fn) => fn().catch(err => { console.error('client_kpi query error:', err.message); return { data: [] } })

        const [
          cancelByClientResult,
          materialsByClientResult,
          orderTypeByClientResult,
          deliveryTimeByClientResult,
          frequencyByClientResult,
          materialAnalyticsResult,
        ] = await Promise.all([
          safeQuery(() => supabase.from('orders').select('client_id, client_name, status').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, total: 0, cancelled: 0 }
              byClient[o.client_id].total++
              if ((o.status || '').toLowerCase() === 'cancelled') byClient[o.client_id].cancelled++
            })
            return { data: Object.values(byClient)
              .filter(c => c.total >= 1)
              .map(c => ({
                client_name: c.client_name,
                total_orders: c.total,
                cancelled_orders: c.cancelled,
                cancel_rate: c.total > 0 ? Math.round((c.cancelled / c.total) * 1000) / 10 : 0,
              }))
              .sort((a, b) => b.cancel_rate - a.cancel_rate)
              .slice(0, 10) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, material').not('material', 'is', null).then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id || !o.material) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, materials: {} }
              o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                byClient[o.client_id].materials[m] = (byClient[o.client_id].materials[m] || 0) + 1
              })
            })
            const clientOrderCounts = {}
            ;(data || []).forEach(o => {
              if (o.client_id) clientOrderCounts[o.client_id] = (clientOrderCounts[o.client_id] || 0) + 1
            })
            return { data: Object.entries(byClient)
              .sort((a, b) => (clientOrderCounts[b[0]] || 0) - (clientOrderCounts[a[0]] || 0))
              .slice(0, 5)
              .map(([, info]) => ({
                client_name: info.client_name,
                materials: Object.entries(info.materials)
                  .map(([name, count]) => ({ name, count }))
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 5),
              })) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, order_type').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, normal: 0, urgent_911: 0 }
              if ((o.order_type || '').toLowerCase().includes('911')) {
                byClient[o.client_id].urgent_911++
              } else {
                byClient[o.client_id].normal++
              }
            })
            return { data: Object.values(byClient)
              .filter(c => (c.normal + c.urgent_911) >= 1)
              .map(c => ({
                client_name: c.client_name,
                normal: c.normal,
                urgent_911: c.urgent_911,
                total: c.normal + c.urgent_911,
              }))
              .sort((a, b) => b.total - a.total)
              .slice(0, 10) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, delivery_date, completed_at, status').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id || !o.delivery_date) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, on_time: 0, late: 0, total_days: 0, count: 0 }
              const deliveredAt = o.completed_at || null
              if (deliveredAt) {
                const diffMs = new Date(deliveredAt) - new Date(o.delivery_date)
                const diffDays = diffMs / (1000 * 60 * 60 * 24)
                byClient[o.client_id].total_days += Math.abs(diffDays)
                byClient[o.client_id].count++
                if (diffMs <= 0) {
                  byClient[o.client_id].on_time++
                } else {
                  byClient[o.client_id].late++
                }
              }
            })
            return { data: Object.values(byClient)
              .filter(c => c.count >= 1)
              .map(c => ({
                client_name: c.client_name,
                avg_delivery_days: c.count > 0 ? Math.round((c.total_days / c.count) * 10) / 10 : 0,
                on_time: c.on_time,
                late: c.late,
                total_delivered: c.count,
              }))
              .sort((a, b) => b.total_delivered - a.total_delivered)
              .slice(0, 10) }
          })),
          safeQuery(() => supabase.from('orders').select('client_id, client_name, created_at').then(({ data, error }) => {
            if (error) throw error
            const byClient = {}
            ;(data || []).forEach(o => {
              if (!o.client_id) return
              if (!byClient[o.client_id]) byClient[o.client_id] = { client_name: o.client_name, months: {}, daily: {} }
              const monthKey = new Date(o.created_at).toISOString().slice(0, 7)
              byClient[o.client_id].months[monthKey] = (byClient[o.client_id].months[monthKey] || 0) + 1
              const dayKey = new Date(o.created_at).toISOString().slice(0, 10)
              byClient[o.client_id].daily[dayKey] = (byClient[o.client_id].daily[dayKey] || 0) + 1
            })
            return { data: Object.values(byClient)
              .filter(c => Object.keys(c.months).length >= 1)
              .map(c => {
                const monthCount = Object.keys(c.months).length
                const totalOrders = Object.values(c.months).reduce((s, v) => s + v, 0)
                const avg = monthCount > 0 ? Math.round((totalOrders / monthCount) * 10) / 10 : 0
                let frequency = 'Baja'
                if (avg >= 4) frequency = 'Alta'
                else if (avg >= 1) frequency = 'Media'
                return {
                  client_name: c.client_name,
                  orders_per_month: avg,
                  total_orders: totalOrders,
                  active_months: monthCount,
                  frequency,
                  months: c.months,
                  daily: c.daily,
                }
              })
              .sort((a, b) => b.orders_per_month - a.orders_per_month)
              .slice(0, 10) }
          })),
          safeQuery(() => {
            let q = supabase.from('orders').select('client_id, client_name, material, created_at, order_type, status')
            if (date_from) q = q.gte('created_at', date_from)
            if (date_to) q = q.lt('created_at', date_to)
            return q.then(({ data, error }) => {
              if (error) throw error
              const materialMap = {}
              const allMaterials = new Set()
              const orderTypeMap = {}
              ;(data || []).forEach(o => {
                if (!o.material) return
                const isUrgent = (o.order_type || '').toLowerCase().includes('911')
                o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                  allMaterials.add(m)
                  if (!materialMap[m]) materialMap[m] = { name: m, total: 0, cancelled: 0, clients: {}, months: {}, daily: {}, normal: 0, urgent: 0 }
                  materialMap[m].total++
                  if ((o.status || '').toLowerCase() === 'cancelled') materialMap[m].cancelled++
                  if (isUrgent) materialMap[m].urgent++
                  else materialMap[m].normal++
                  if (!orderTypeMap[m]) orderTypeMap[m] = { name: m, normal: 0, urgent: 0 }
                  if (isUrgent) orderTypeMap[m].urgent++
                  else orderTypeMap[m].normal++
                  if (o.client_id) {
                    if (!materialMap[m].clients[o.client_id]) materialMap[m].clients[o.client_id] = { client_name: o.client_name, count: 0 }
                    materialMap[m].clients[o.client_id].count++
                  }
                  const monthKey = new Date(o.created_at).toISOString().slice(0, 7)
                  materialMap[m].months[monthKey] = (materialMap[m].months[monthKey] || 0) + 1
                  const dayKey = new Date(o.created_at).toISOString().slice(0, 10)
                  materialMap[m].daily[dayKey] = (materialMap[m].daily[dayKey] || 0) + 1
                })
              })
              const totalOrdersWithMaterial = Object.values(materialMap).reduce((s, m) => s + m.total, 0)
              return { data: {
                all_materials: [...allMaterials].sort(),
                summary: Object.values(materialMap)
                  .map(m => ({
                    name: m.name,
                    total_orders: m.total,
                    cancelled_orders: m.cancelled,
                    cancel_rate: m.total > 0 ? Math.round((m.cancelled / m.total) * 1000) / 10 : 0,
                    usage_pct: totalOrdersWithMaterial > 0 ? Math.round((m.total / totalOrdersWithMaterial) * 1000) / 10 : 0,
                    normal_orders: m.normal,
                    urgent_orders: m.urgent,
                    top_clients: Object.values(m.clients).sort((a, b) => b.count - a.count).slice(0, 5).map(c => ({ client_name: c.client_name, count: c.count })),
                    monthly_trend: Object.entries(m.months).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
                    daily: m.daily,
                  }))
                  .sort((a, b) => b.total_orders - a.total_orders),
                order_type_by_material: Object.values(orderTypeMap).sort((a, b) => (b.normal + b.urgent) - (a.normal + a.urgent)),
              } }
            })
          }),
        ])

        let materialComparison = null
        if (compare_from || compare_to) {
          try {
            let pq = supabase.from('orders').select('material, status, created_at')
            if (compare_from) pq = pq.gte('created_at', compare_from)
            if (compare_to) pq = pq.lt('created_at', compare_to)
            const prevResult = await pq
            const prevMatMap = {}
            ;(prevResult.data || []).forEach(o => {
              if (!o.material) return
              o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                if (!prevMatMap[m]) prevMatMap[m] = { name: m, total: 0, cancelled: 0, daily: {}, months: {} }
                prevMatMap[m].total++
                if ((o.status || '').toLowerCase() === 'cancelled') prevMatMap[m].cancelled++
                const dayKey = new Date(o.created_at).toISOString().slice(0, 10)
                prevMatMap[m].daily[dayKey] = (prevMatMap[m].daily[dayKey] || 0) + 1
                const monthKey = new Date(o.created_at).toISOString().slice(0, 7)
                prevMatMap[m].months[monthKey] = (prevMatMap[m].months[monthKey] || 0) + 1
              })
            })
            const prevTotal = Object.values(prevMatMap).reduce((s, m) => s + m.total, 0)
            materialComparison = {
              period_total: prevTotal,
              summary: Object.values(prevMatMap)
                .map(m => ({
                  name: m.name,
                  total_orders: m.total,
                  cancel_rate: m.total > 0 ? Math.round((m.cancelled / m.total) * 1000) / 10 : 0,
                  usage_pct: prevTotal > 0 ? Math.round((m.total / prevTotal) * 1000) / 10 : 0,
                  daily: m.daily,
                  monthly_trend: Object.entries(m.months)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([month, count]) => ({ month, count })),
                }))
                .sort((a, b) => b.total_orders - a.total_orders),
            }
          } catch (err) {
            console.error('materialComparison error:', err.message)
          }
        }

        const agedOrders = (pendingAged.data || []).map(o => ({
          id: o.id,
          client_name: o.client_name,
          days_pending: (now - new Date(o.created_at)) / (1000 * 60 * 60 * 24),
        }))

        const paymentByClientRaw = await supabase.from('orders')
          .select('client_id, client_name, payment_status, price, id, created_at, invoice_number')
          .in('payment_status', ['credito', 'parcial'])
          .not('status', 'in', '(cancelled,in_completed,in_delivered)')

        if (paymentByClientRaw.error) console.error('paymentByClient:', paymentByClientRaw.error.message)

        const byClientMap = {}
        ;(paymentByClientRaw.data || []).forEach(o => {
          if (!o.client_id) return
          if (!byClientMap[o.client_id]) {
            byClientMap[o.client_id] = {
              client_id: o.client_id,
              client_name: o.client_name,
              credito_count: 0,
              parcial_count: 0,
              total_pending: 0,
              orders: [],
            }
          }
          if (o.payment_status === 'credito') byClientMap[o.client_id].credito_count++
          if (o.payment_status === 'parcial') byClientMap[o.client_id].parcial_count++
          const price = parseFloat(o.price) || 0
          byClientMap[o.client_id].total_pending += price
          byClientMap[o.client_id].orders.push({
            id: o.id,
            price,
            payment_status: o.payment_status,
            created_at: o.created_at,
            invoice_number: o.invoice_number || '',
          })
        })

        // Order counts by date range for dynamic card
        function buildCountQueries(dateFrom, dateTo) {
          const mkBase = () => {
            let q = supabase.from('orders').select('id', { count: 'exact', head: true })
            if (dateFrom) q = q.gte('created_at', dateFrom)
            if (dateTo) q = q.lt('created_at', dateTo)
            return q
          }
          const mkActive = () => mkBase().not('status', 'in', '(cancelled,in_completed,in_delivered)')

          return Promise.all([
            mkBase(),
            mkActive().eq('order_design_type', 'INTERNAL_DESING'),
            mkActive().eq('order_design_type', 'EXTERNAL_DESING'),
            mkActive().eq('order_type', 'orden normal'),
            mkActive().eq('order_type', 'orden 911'),
            mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden normal'),
            mkActive().eq('order_design_type', 'INTERNAL_DESING').eq('order_type', 'orden 911'),
            mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden normal'),
            mkActive().eq('order_design_type', 'EXTERNAL_DESING').eq('order_type', 'orden 911'),
            mkActive().eq('payment_status', 'Pending_Payment'),
            mkActive().eq('payment_status', 'parcial'),
            mkActive().eq('payment_status', 'pagado'),
            mkActive().eq('payment_status', 'credito'),
            mkActive().eq('status', 'Pending'),
            mkActive().eq('status', 'in_Design'),
            mkActive().eq('status', 'in_Quote'),
            mkActive().eq('status', 'in_Production'),
            mkActive().eq('status', 'in_Termination'),
            mkActive().eq('status', 'in_Completed'),
            mkActive().eq('status', 'in_Delivered'),
            mkActive().eq('operational_status', 'active'),
            mkActive().eq('operational_status', 'blocked'),
          ]).then(([all, internal, external, normal, urgent, intNorm, intUrg, extNorm, extUrg, payPend, payPart, payPaid, payCred, wfPend, wfDes, wfQuo, wfPro, wfTer, wfCom, wfDel, opAct, opBlk]) => ({
            totals: {
              all: all.count || 0,
              internal: internal.count || 0,
              external: external.count || 0,
              normal: normal.count || 0,
              urgent_911: urgent.count || 0,
            },
            combinations: {
              internal_normal: intNorm.count || 0,
              internal_911: intUrg.count || 0,
              external_normal: extNorm.count || 0,
              external_911: extUrg.count || 0,
            },
            payment: {
              pending: payPend.count || 0,
              partial: payPart.count || 0,
              paid: payPaid.count || 0,
              credit: payCred.count || 0,
            },
            workflow: {
              pending: wfPend.count || 0,
              design: wfDes.count || 0,
              quote: wfQuo.count || 0,
              production: wfPro.count || 0,
              termination: wfTer.count || 0,
              completed: wfCom.count || 0,
              delivered: wfDel.count || 0,
            },
            operational: {
              active: opAct.count || 0,
              blocked: opBlk.count || 0,
            },
          }))
        }

        // Status breakdown by date range for pipeline
        function buildStatusBreakdown(dateFrom, dateTo) {
          let q = supabase.from('orders').select('status')
          if (dateFrom) q = q.gte('created_at', dateFrom)
          if (dateTo) q = q.lt('created_at', dateTo)
          return q.then(({ data }) => {
            const breakdown = {}
            ;(data || []).forEach(o => {
              const s = (o.status || 'unknown').toLowerCase()
              breakdown[s] = (breakdown[s] || 0) + 1
            })
            return breakdown
          })
        }

        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        const weekDate = new Date()
        weekDate.setDate(weekDate.getDate() - weekDate.getDay())
        const weekStart = weekDate.toISOString()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const d30Ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const d90Ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const m3Ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const m6Ago = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
        const y1Ago = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
        const y3Ago = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString()
        const y5Ago = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString()

        const [todayCounts, weekCounts, monthCounts, d30Counts, d90Counts, m3Counts, m6Counts, y1Counts, y3Counts, y5Counts, allCounts, todayBreakdown, weekBreakdown, monthBreakdown, d30Breakdown, d90Breakdown, m3Breakdown, m6Breakdown, y1Breakdown, y3Breakdown, y5Breakdown, allBreakdown] = await Promise.all([
          buildCountQueries(todayStart, null),
          buildCountQueries(weekStart, null),
          buildCountQueries(monthStart, null),
          buildCountQueries(d30Ago, null),
          buildCountQueries(d90Ago, null),
          buildCountQueries(m3Ago, null),
          buildCountQueries(m6Ago, null),
          buildCountQueries(y1Ago, null),
          buildCountQueries(y3Ago, null),
          buildCountQueries(y5Ago, null),
          buildCountQueries(null, null),
          buildStatusBreakdown(todayStart, null),
          buildStatusBreakdown(weekStart, null),
          buildStatusBreakdown(monthStart, null),
          buildStatusBreakdown(d30Ago, null),
          buildStatusBreakdown(d90Ago, null),
          buildStatusBreakdown(m3Ago, null),
          buildStatusBreakdown(m6Ago, null),
          buildStatusBreakdown(y1Ago, null),
          buildStatusBreakdown(y3Ago, null),
          buildStatusBreakdown(y5Ago, null),
          buildStatusBreakdown(null, null),
        ])

        result = {
          business_summary: bs.data || null,
          orders_analytics: oa.data || null,
          client_analytics: ca.data || null,
          user_analytics: ui.data || null,
          production_insights: pi.data || null,
          smart_alerts: sa.data || null,
          orders_trend: ot.data || null,
          sla_violations: sv.data || null,
          total_employees: empCount.count || 0,
          total_employees_all: empCountAll.count || 0,
          total_clients: clientCount.count || 0,
          payment_summary: {
            credito: credito.count || 0,
            parcial: parcial.count || 0,
            pending_payment: pendingPayment.count || 0,
            pending_payment_aged: {
              count: agedOrders.length,
              orders: agedOrders,
            },
            by_client: Object.values(byClientMap)
              .filter(c => c.credito_count + c.parcial_count > 0)
              .sort((a, b) => b.total_pending - a.total_pending),
          },
          top_materials: materialsResult?.data || [],
          client_kpis: {
            cancellation_by_client: cancelByClientResult?.data || [],
            materials_by_client: materialsByClientResult?.data || [],
            order_type_by_client: orderTypeByClientResult?.data || [],
            delivery_time_by_client: deliveryTimeByClientResult?.data || [],
            frequency_by_client: frequencyByClientResult?.data || [],
            material_analytics: materialAnalyticsResult?.data || {},
            material_comparison: materialComparison,
            retention_new_clients: { rate: ca.data?.retention_rate?.rate || 0 },
          },
          order_counts_by_date: {
            today: todayCounts,
            week: weekCounts,
            month: monthCounts,
            '30d': d30Counts,
            '90d': d90Counts,
            '3m': m3Counts,
            '6m': m6Counts,
            '1y': y1Counts,
            '3y': y3Counts,
            '5y': y5Counts,
            all: allCounts,
          },
          pipeline_by_date: {
            today: todayBreakdown,
            week: weekBreakdown,
            month: monthBreakdown,
            '30d': d30Breakdown,
            '90d': d90Breakdown,
            '3m': m3Breakdown,
            '6m': m6Breakdown,
            '1y': y1Breakdown,
            '3y': y3Breakdown,
            '5y': y5Breakdown,
            all: allBreakdown,
          },
        }
        break
      }

      default:
        return { status: 400, body: { error: `Acción no válida: ${action}` } }
    }

    return { status: 200, body: result }
  } catch (error) {
    console.error('KPI Data Error:', error)
    return { status: 500, body: { error: error?.message || 'Error al obtener datos KPI' } }
  }
}
