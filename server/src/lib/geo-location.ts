export async function getLocationFromIP(ip: string | null): Promise<string> {
  if (!ip || ip === '::1' || ip === '127.0.0.1') return 'Local'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,country`, {
      signal: controller.signal,
    })

    if (!res.ok) return 'Unknown'

    const data = await res.json()
    if (data.status === 'success' && data.city && data.country) {
      return `${data.city}, ${data.country}`
    }
    return 'Unknown'
  } catch {
    return 'Unknown'
  } finally {
    clearTimeout(timeout)
  }
}