/**
 * Chrome opens an output stream when a media element starts playing, and the
 * media clock advances from the moment Chrome begins feeding it while the audio
 * server still needs time to start consuming. That cost is paid per stream, not
 * per device, so a primer that stops before the sentence begins does not help:
 * its stream closes and the sentence opens a cold one of its own.
 *
 * The primer therefore loops until shortly after the sentence is audible. The
 * sentence joins a mixer that is already running, and nothing of its opening is
 * spent starting the stream.
 */

const PRIMER_SAMPLE_RATE = 24_000
const PRIMER_SECONDS = 0.4
const PRIMER_CONTENT_TYPE = 'audio/wav'
const BYTES_PER_SAMPLE = 2
const WAVE_HEADER_BYTES = 44
const PCM_FORMAT_TAG = 1
const MONO_CHANNEL_COUNT = 1
const BITS_PER_SAMPLE = 16

/**
 * Digital silence can be discarded before it reaches the device, which would
 * leave the output stream closed. One least significant bit is a -90 dBFS
 * signal: inaudible, but real enough to keep the stream running.
 */
const DITHER_AMPLITUDE = 1

/** How long the primer keeps running once the sentence is audible. */
const HANDOFF_OVERLAP_MS = 1_500

/** Bounds the primer when no sentence ever reaches playback. */
const MAX_PRIMER_MS = 30_000

let primer: HTMLAudioElement | null = null
let stopHandle: ReturnType<typeof setTimeout> | null = null

/**
 * Starts or extends the looping primer. Callers do not await it; it only has to
 * be running before the first audible sample of the session.
 */
export function startAudioOutputPrimer(): void {
  clearStopHandle()
  stopHandle = setTimeout(stopAudioOutputPrimer, MAX_PRIMER_MS)

  const element = (primer ??= createPrimerElement())
  if (!element.paused) return

  element.currentTime = 0
  void element.play().catch(() => {
    // A blocked primer only means the sentence pays the stream startup itself,
    // which is exactly the unprimed behavior.
  })
}

/**
 * Keeps the primer alive across the handoff, then stops it so an idle document
 * does not hold the output device open.
 */
export function releaseAudioOutputPrimer(): void {
  clearStopHandle()
  stopHandle = setTimeout(stopAudioOutputPrimer, HANDOFF_OVERLAP_MS)
}

function stopAudioOutputPrimer(): void {
  clearStopHandle()
  if (!primer || primer.paused) return
  primer.pause()
}

function clearStopHandle(): void {
  if (stopHandle !== null) clearTimeout(stopHandle)
  stopHandle = null
}

function createPrimerElement(): HTMLAudioElement {
  const element = new Audio(
    URL.createObjectURL(new Blob([createPrimerWaveFile()], { type: PRIMER_CONTENT_TYPE }))
  )
  element.loop = true
  return element
}

/** Builds the primer as uncompressed PCM so no decoder delay is introduced. */
export function createPrimerWaveFile(): Uint8Array<ArrayBuffer> {
  const sampleCount = Math.round(PRIMER_SECONDS * PRIMER_SAMPLE_RATE)
  const dataBytes = sampleCount * BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(WAVE_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, WAVE_HEADER_BYTES - 8 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, PCM_FORMAT_TAG, true)
  view.setUint16(22, MONO_CHANNEL_COUNT, true)
  view.setUint32(24, PRIMER_SAMPLE_RATE, true)
  view.setUint32(28, PRIMER_SAMPLE_RATE * BYTES_PER_SAMPLE, true)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  // Alternating polarity keeps the dither off DC, where a high-pass filter in
  // the audio path could remove it again.
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const offset = WAVE_HEADER_BYTES + sample * BYTES_PER_SAMPLE
    view.setInt16(offset, sample % 2 === 0 ? DITHER_AMPLITUDE : -DITHER_AMPLITUDE, true)
  }

  return new Uint8Array(buffer)
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}
