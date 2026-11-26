export interface SoundOption {
  id: string
  label: string
  url?: string
}

const soundFiles = import.meta.glob('../../sound/*.{mp3,wav,ogg,m4a,flac,webm}', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function baseName(path: string) {
  const file = path.split('/').pop() || path
  return file.replace(/\.[^.]+$/, '')
}

const discovered = Object.entries(soundFiles)
  .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
  .map(([path, url]) => ({ name: baseName(path), url }))

export const rainOptions: SoundOption[] = [
  ...discovered
    .filter(({ name }) => /雨|rain|雷|thunder|stream|water/i.test(name) || !/翻|页|纸|page|turn|flip|paper/i.test(name))
    .map(({ name, url }) => ({ id: 'file:' + name, label: name, url })),
  { id: 'synth', label: '轻柔细雨（原版合成）' },
]

export const turnOptions: SoundOption[] = [
  ...discovered
    .filter(({ name }) => /翻|页|纸|page|turn|flip|paper/i.test(name) || !/雨|rain|雷|thunder|stream|water/i.test(name))
    .map(({ name, url }) => ({ id: 'file:' + name, label: name, url })),
  { id: 'synth', label: '轻沙翻页（原版合成）' },
]

const defaultRainSound = rainOptions.find(o => o.id !== 'synth')?.id ?? 'synth'
const defaultTurnSound = turnOptions.find(o => o.id !== 'synth')?.id ?? 'synth'

export type Levels = {
  rain: number
  brown: number
  turn: number
  muted: boolean
  rainSound: string
  turnSound: string
}

export const quiet: Levels = {
  rain: 0,
  brown: 0,
  turn: 0.35,
  muted: false,
  rainSound: defaultRainSound,
  turnSound: defaultTurnSound,
}

export function normalizeLevels(raw?: Partial<Levels> | null): Levels {
  const merged = { ...quiet, ...raw }
  if (!rainOptions.some(o => o.id === merged.rainSound)) merged.rainSound = defaultRainSound
  if (!turnOptions.some(o => o.id === merged.turnSound)) merged.turnSound = defaultTurnSound
  return merged
}

interface ActiveRainSource {
  id: string
  stop: () => void
}

export class SoundEngine {
  private ctx?: AudioContext
  private master?: GainNode
  private tracks?: { rain: GainNode; brown: GainNode }
  private levels = quiet
  private bufferCache = new Map<string, Promise<AudioBuffer | null>>()
  private activeRain?: ActiveRainSource
  private targetRainId = ''

  async activate(levels: Levels) {
    if (!this.ctx) {
      const ctx = this.ctx = new AudioContext()
      this.master = ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(ctx.destination)

      const brownGain = this.createBrownTrack(ctx)
      const rainGain = ctx.createGain()
      rainGain.gain.value = 0
      rainGain.connect(this.master)

      this.tracks = { rain: rainGain, brown: brownGain }
    }
    this.configure(levels)
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    // Pre-warm turn audio buffer once context is active
    const turnOpt = turnOptions.find(o => o.id === levels.turnSound)
    if (turnOpt?.url) void this.loadBuffer(turnOpt.url)
  }

  private createBrownTrack(ctx: AudioContext) {
    const source = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const volume = ctx.createGain()
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    let lastOut = 0
    for (let i = 0; i < samples.length; i++) {
      const white = Math.random() * 2 - 1
      lastOut = (lastOut + 0.02 * white) / 1.02
      samples[i] = 3.5 * lastOut
    }
    source.buffer = buffer
    source.loop = true
    filter.type = 'lowpass'
    filter.frequency.value = 250
    volume.gain.value = 0
    source.connect(filter).connect(volume).connect(this.master!)
    source.start()
    return volume
  }

  private startSynthRain(ctx: AudioContext, destination: AudioNode): ActiveRainSource {
    const source = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const mod = ctx.createGain()
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    const fade = ctx.createGain()

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    const b = new Float64Array(7)
    for (let i = 0; i < samples.length; i++) {
      const white = Math.random() * 2 - 1
      b[0] = 0.99886 * b[0] + white * 0.0555179
      b[1] = 0.99332 * b[1] + white * 0.0750759
      b[2] = 0.969 * b[2] + white * 0.153852
      b[3] = 0.8665 * b[3] + white * 0.3104856
      b[4] = 0.55 * b[4] + white * 0.5329522
      b[5] = -0.7616 * b[5] - white * 0.016898
      samples[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + white * 0.5362) * 0.11
      b[6] = white * 0.115926
    }

    source.buffer = buffer
    source.loop = true
    filter.type = 'bandpass'
    filter.frequency.value = 800
    mod.gain.value = 0.82
    lfo.frequency.value = 0.13
    depth.gain.value = 0.16
    lfo.connect(depth).connect(mod.gain)

    const t = ctx.currentTime
    fade.gain.setValueAtTime(0, t)
    fade.gain.linearRampToValueAtTime(1, t + 0.08)

    source.connect(filter).connect(mod).connect(fade).connect(destination)
    source.start()
    lfo.start()

    return {
      id: 'synth',
      stop: () => {
        const now = ctx.currentTime
        fade.gain.cancelScheduledValues(now)
        fade.gain.setValueAtTime(fade.gain.value, now)
        fade.gain.linearRampToValueAtTime(0, now + 0.06)
        window.setTimeout(() => {
          try { source.stop(); lfo.stop() } catch { /* already stopped */ }
          source.disconnect()
          filter.disconnect()
          mod.disconnect()
          lfo.disconnect()
          depth.disconnect()
          fade.disconnect()
        }, 80)
      },
    }
  }

  private startBufferRain(ctx: AudioContext, destination: AudioNode, id: string, buffer: AudioBuffer): ActiveRainSource {
    const source = ctx.createBufferSource()
    const fade = ctx.createGain()
    source.buffer = buffer
    source.loop = true

    const t = ctx.currentTime
    fade.gain.setValueAtTime(0, t)
    fade.gain.linearRampToValueAtTime(1, t + 0.1)

    source.connect(fade).connect(destination)
    source.start()

    return {
      id,
      stop: () => {
        const now = ctx.currentTime
        fade.gain.cancelScheduledValues(now)
        fade.gain.setValueAtTime(fade.gain.value, now)
        fade.gain.linearRampToValueAtTime(0, now + 0.08)
        window.setTimeout(() => {
          try { source.stop() } catch { /* already stopped */ }
          source.disconnect()
          fade.disconnect()
        }, 100)
      },
    }
  }

  private loadBuffer(url: string): Promise<AudioBuffer | null> {
    const existing = this.bufferCache.get(url)
    if (existing) return existing
    const ctx = this.ctx
    if (!ctx) return Promise.resolve(null)
    const pending = fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Audio fetch failed')
        return res.arrayBuffer()
      })
      .then(data => ctx.decodeAudioData(data))
      .catch(() => null)
    this.bufferCache.set(url, pending)
    return pending
  }

  private async ensureRainSource(id: string) {
    const ctx = this.ctx
    const tracks = this.tracks
    if (!ctx || !tracks) return
    if (this.activeRain?.id === id) return

    const opt = rainOptions.find(o => o.id === id)
    let nextSource: ActiveRainSource | undefined

    if (opt?.url) {
      const buffer = await this.loadBuffer(opt.url)
      if (this.targetRainId !== id || !this.ctx || !this.tracks) return
      if (buffer) nextSource = this.startBufferRain(this.ctx, this.tracks.rain, id, buffer)
    }
    if (!nextSource) {
      if (this.targetRainId !== id || !this.ctx || !this.tracks) return
      nextSource = this.startSynthRain(this.ctx, this.tracks.rain)
    }

    this.activeRain?.stop()
    this.activeRain = nextSource
  }

  configure(levels: Levels) {
    this.levels = levels
    if (!this.ctx || !this.tracks || !this.master) return
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(levels.muted ? 0 : 0.7, t, 0.025)
    this.tracks.rain.gain.setTargetAtTime(levels.rain, t, 0.05)
    this.tracks.brown.gain.setTargetAtTime(levels.brown, t, 0.05)

    if (levels.rain > 0) {
      if (this.targetRainId !== levels.rainSound || !this.activeRain) {
        this.targetRainId = levels.rainSound
        void this.ensureRainSource(levels.rainSound)
      }
    }
  }

  private playSynthTurn(ctx: AudioContext, master: GainNode, level: number) {
    const source = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.12), ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    source.buffer = buffer
    filter.type = 'bandpass'
    const t = ctx.currentTime
    filter.frequency.setValueAtTime(900, t)
    filter.frequency.exponentialRampToValueAtTime(2400, t + 0.12)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * 0.6), t + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    source.connect(filter).connect(gain).connect(master)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
    }
    source.start()
  }

  async turn(levels: Levels) {
    if (levels.muted || !levels.turn) return
    await this.activate(levels)
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return

    const opt = turnOptions.find(o => o.id === levels.turnSound)
    if (opt?.url) {
      const buffer = await this.loadBuffer(opt.url)
      if (buffer && this.ctx === ctx && this.master === master) {
        const source = ctx.createBufferSource()
        const gain = ctx.createGain()
        source.buffer = buffer
        gain.gain.value = Math.max(0.0001, Math.min(1.5, this.levels.turn * 0.95))
        source.connect(gain).connect(master)
        source.onended = () => {
          source.disconnect()
          gain.disconnect()
        }
        source.start()
        return
      }
    }
    this.playSynthTurn(ctx, master, this.levels.turn)
  }

  dispose() {
    this.targetRainId = ''
    this.activeRain?.stop()
    this.activeRain = undefined
    this.bufferCache.clear()
    if (this.ctx) void this.ctx.close()
    this.ctx = undefined
    this.master = undefined
    this.tracks = undefined
  }
}
