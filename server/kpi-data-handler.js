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
          .select('client_id, client_name, payment_status, price, id, created_at')
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

      case 'all': {
        const now = new Date()
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

        const [bs, oa, ca, ui, pi, sa, ot, sv, empCount, clientCount, credito, parcial, pendingPayment, pendingAged, materialsResult] = await Promise.all([
          supabase.rpc('kpi_business_summary', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_orders_analytics', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_client_analytics', { p_date_from: date_from, p_date_to: date_to, p_compare_from: compare_from, p_compare_to: compare_to }),
          supabase.rpc('kpi_user_analytics', { p_date_from: date_from, p_date_to: date_to }),
          supabase.rpc('kpi_production_insights', { p_date_from: date_from, p_date_to: date_to }),
          supabase.rpc('kpi_smart_alerts'),
          supabase.rpc('kpi_orders_trend', { p_days: 30 }),
          supabase.rpc('kpi_sla_violations'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('role', 'admin').eq('employment_status', true),
          supabase.from('clients').select('id', { count: 'exact', head: true }),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'credito').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'parcial').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'Pending_Payment').not('status', 'in', '(cancelled,in_completed,in_delivered)'),
          supabase.from('orders').select('id, created_at').not('status', 'in', '(cancelled,in_completed,in_delivered)').gte('created_at', threeDaysAgo.toISOString()),
          supabase.from('orders').select('material').not('material', 'is', null).then(({ data }) => {
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
          }),
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
          safeQuery(() => supabase.from('orders').select('client_id, client_name, material, created_at, order_type, status').then(({ data, error }) => {
            if (error) throw error
            const materialMap = {}
            const allMaterials = new Set()
            ;(data || []).forEach(o => {
              if (!o.material) return
              o.material.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                allMaterials.add(m)
                if (!materialMap[m]) materialMap[m] = { name: m, total: 0, cancelled: 0, clients: {}, months: {} }
                materialMap[m].total++
                if ((o.status || '').toLowerCase() === 'cancelled') materialMap[m].cancelled++
                if (o.client_id) {
                  if (!materialMap[m].clients[o.client_id]) materialMap[m].clients[o.client_id] = { client_name: o.client_name, count: 0 }
                  materialMap[m].clients[o.client_id].count++
                }
                const monthKey = new Date(o.created_at).toISOString().slice(0, 7)
                materialMap[m].months[monthKey] = (materialMap[m].months[monthKey] || 0) + 1
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
                  usage_pct: totalOrdersWithMaterial > 0 ? Math.round((m.total / totalOrdersWithMaterial) * 1000) / 10 : 0,
                  top_clients: Object.values(m.clients).sort((a, b) => b.count - a.count).slice(0, 5).map(c => ({ client_name: c.client_name, count: c.count })),
                  monthly_trend: Object.entries(m.months).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
                }))
                .sort((a, b) => b.total_orders - a.total_orders),
            } }
          })),
        ])

        const agedOrders = (pendingAged.data || []).map(o => ({
          id: o.id,
          client_name: o.client_name,
          days_pending: (now - new Date(o.created_at)) / (1000 * 60 * 60 * 24),
        }))

        const paymentByClientRaw = await supabase.from('orders')
          .select('client_id, client_name, payment_status, price, id, created_at')
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
