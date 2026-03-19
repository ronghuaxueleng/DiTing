export function getDefaultAdvertiseUrl(port: number) {
    return `http://127.0.0.1:${port}`
}

export function getEffectiveAdvertiseUrl(advertiseUrl: string, port: number) {
    const trimmed = advertiseUrl.trim()
    return trimmed || getDefaultAdvertiseUrl(port)
}
