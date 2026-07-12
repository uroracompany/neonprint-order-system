import { handleKpiData } from '../../server/kpi-data-handler.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const authHeader = req.headers.authorization || ''
  const env = {
    ...process.env,
    authHeader,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }

  const result = await handleKpiData(req.body, env)
  return res.status(result.status).json(result.body)
}