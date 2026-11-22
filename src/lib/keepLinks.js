// A newer answer, but each ready video keeps the link it already has.
export function keepLinks(was, saved) {
  if (!was || !saved) return saved
  const keep = (v) => {
    const old = v && [was.video, was.otherVideo].find((w) => w?.url && w.side === v.side)
    return old && v.url ? { ...v, url: old.url } : v
  }
  return { ...saved, video: keep(saved.video), otherVideo: keep(saved.otherVideo) }
}
