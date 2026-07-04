export interface ParsedUA {
  browser: string
  os: string
  deviceType: string
}

export function parseUserAgent(ua: string): ParsedUA {
  return {
    browser: parseBrowser(ua),
    os: parseOS(ua),
    deviceType: parseDeviceType(ua),
  }
}

function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Unknown'
}

function parseOS(ua: string): string {
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Unknown'
}

function parseDeviceType(ua: string): string {
  if (/iPad/.test(ua)) return 'Tablet'
  if (/Mobile|iPhone|Android(?!.*(?:Tablet|Kindle))/.test(ua)) return 'Mobile'
  if (/Tablet|Kindle/.test(ua)) return 'Tablet'
  return 'Desktop'
}