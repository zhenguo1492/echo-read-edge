/**
 * Paints non-destructive reading and selection highlights over page content.
 * Pronunciation-assessment score colors are intentionally excluded; this worklet
 * only supports the retained word, sentence, hover, and selection layers.
 */

function getColorBrightness(color) {
  if (!color || color === 'transparent') return 255

  const normalized = String(color).trim()
  let red
  let green
  let blue

  if (normalized[0] === '#') {
    const hex = normalized.slice(1)
    if (hex.length === 3) {
      red = Number.parseInt(hex[0] + hex[0], 16)
      green = Number.parseInt(hex[1] + hex[1], 16)
      blue = Number.parseInt(hex[2] + hex[2], 16)
    } else if (hex.length >= 6) {
      red = Number.parseInt(hex.slice(0, 2), 16)
      green = Number.parseInt(hex.slice(2, 4), 16)
      blue = Number.parseInt(hex.slice(4, 6), 16)
    }
  } else if (normalized.startsWith('rgb')) {
    const parts = normalized.match(/[\d.]+/g)
    if (parts && parts.length >= 3) {
      red = Number.parseInt(parts[0], 10)
      green = Number.parseInt(parts[1], 10)
      blue = Number.parseInt(parts[2], 10)
    }
  }

  if (red === undefined || green === undefined || blue === undefined) return 255
  return Math.round((red * 299 + green * 587 + blue * 114) / 1000)
}

function addRoundedRectPath(context, rect, radius, matrix) {
  let { x, y, width, height } = rect
  let adjustedRadius = radius

  if (matrix && matrix.length >= 4) {
    const scaleX = matrix[0] || 1
    const scaleY = matrix[3] || 1
    if (scaleX !== 1) {
      x /= scaleX
      width /= scaleX
    }
    if (scaleY !== 1) {
      y /= scaleY
      height /= scaleY
    }
    adjustedRadius /= Math.min(Math.abs(scaleX), Math.abs(scaleY))
  }

  adjustedRadius = Math.max(0, Math.min(adjustedRadius, width / 2, height / 2))
  context.moveTo(x + adjustedRadius, y)
  context.arcTo(x + width, y, x + width, y + height, adjustedRadius)
  context.arcTo(x + width, y + height, x, y + height, adjustedRadius)
  context.arcTo(x, y + height, x, y, adjustedRadius)
  context.arcTo(x, y, x + width, y, adjustedRadius)
}

function parsePositionInfo(value) {
  if (!value || value === 'none') return []

  const values = value.split(',')
  const rects = []
  for (let index = 0; index + 3 < values.length; index += 4) {
    const width = Number.parseFloat(values[index + 2])
    const height = Number.parseFloat(values[index + 3])
    if (width > 0 && height > 0) {
      rects.push({
        x: Number.parseFloat(values[index]),
        y: Number.parseFloat(values[index + 1]),
        width,
        height
      })
    }
  }
  return rects
}

class EchoHighlightPainter {
  static get inputProperties() {
    return [
      '--echoHighlightWordInfo',
      '--echoHighlightSentenceInfo',
      '--echoHighlightHoverInfo',
      '--echoHighlightSelectionInfo',
      '--echoElemColor',
      '--echoElemMatrix',
      '--echoSentenceColorDark',
      '--echoSentenceColorLight',
      '--echoWordColorDark',
      '--echoWordColorLight',
      '--echoHoverColorDark',
      '--echoHoverColorLight',
      '--echoSelectionColorDark',
      '--echoSelectionColorLight'
    ]
  }

  paint(context, _size, properties) {
    const getProperty = (name) => {
      const property = properties.get(name)
      if (!property) return ''

      let value = String(property).trim()
      if (value.length > 1 && (value[0] === '"' || value[0] === "'")) {
        value = value.slice(1, -1)
      }
      return value
    }

    const matrixValues = getProperty('--echoElemMatrix')
      .split(',')
      .map((value) => Number.parseFloat(value))
    const matrix = matrixValues.length >= 4 ? matrixValues : [1, 0, 0, 1, 0, 0]
    const isLightBackground = getColorBrightness(getProperty('--echoElemColor')) >= 128

    const drawLayer = (positionProperty, darkColorProperty, lightColorProperty, fallback) => {
      const rects = parsePositionInfo(getProperty(positionProperty))
      if (rects.length === 0) return

      const preferredColor = isLightBackground
        ? getProperty(darkColorProperty)
        : getProperty(lightColorProperty)
      context.fillStyle = preferredColor || fallback
      context.beginPath()
      for (const rect of rects) addRoundedRectPath(context, rect, 3, matrix)
      context.fill()
    }

    drawLayer(
      '--echoHighlightSelectionInfo',
      '--echoSelectionColorDark',
      '--echoSelectionColorLight',
      'rgba(209, 213, 219, 0.45)'
    )
    drawLayer(
      '--echoHighlightHoverInfo',
      '--echoHoverColorDark',
      '--echoHoverColorLight',
      'rgba(134, 239, 172, 0.3)'
    )
    drawLayer(
      '--echoHighlightSentenceInfo',
      '--echoSentenceColorDark',
      '--echoSentenceColorLight',
      'rgba(96, 165, 250, 0.2)'
    )
    drawLayer(
      '--echoHighlightWordInfo',
      '--echoWordColorDark',
      '--echoWordColorLight',
      'rgba(59, 130, 246, 0.45)'
    )
  }
}

if (typeof registerPaint !== 'undefined') {
  registerPaint('echoHighlighter', EchoHighlightPainter)
}

