import { useCallback, useRef, useState } from 'react'

// Measures the Daily spending chart so clipped-bar labels can be packed into
// rows (utils/dailyScale.js packClipLabels). Returns [metrics, chartRef]; the
// caller attaches chartRef to the chart element ONLY while a bar is clipped,
// so a chart with no outliers is never observed. A callback ref is used so
// the observer follows the element through the page's loading state and the
// hook can sit above the early return. State is set from the ResizeObserver
// callback only, never synchronously. Font size and bar gap come from CSS
// (--clip-font, column-gap), so no breakpoint is hardcoded here.
export function useClipLabelMetrics() {
  const [metrics, setMetrics] = useState(null)
  const roRef = useRef(null)

  const chartRef = useCallback((el) => {
    if (roRef.current) {
      roRef.current.disconnect()
      roRef.current = null
    }
    if (!el || typeof ResizeObserver === 'undefined') return
    const read = () => {
      const cs = getComputedStyle(el)
      const next = {
        width: el.clientWidth,
        fontPx: parseFloat(cs.getPropertyValue('--clip-font')) || 11,
        gapPx: parseFloat(cs.columnGap) || 0,
      }
      setMetrics((prev) => (
        prev && prev.width === next.width && prev.fontPx === next.fontPx && prev.gapPx === next.gapPx ? prev : next
      ))
    }
    roRef.current = new ResizeObserver(read)
    roRef.current.observe(el)
  }, [])

  return [metrics, chartRef]
}
