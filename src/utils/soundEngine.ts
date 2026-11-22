export type Levels = { rain: number; brown: number; turn: number; muted: boolean }
export const quiet: Levels = { rain: 0, brown: 0, turn: 0.35, muted: false }
export class SoundEngine {
  private ctx?: AudioContext
  private master?: GainNode
  private tracks?: { rain: GainNode; brown: GainNode }
  private levels = quiet
  async activate(levels: Levels) {
    if (!this.ctx) {
      const ctx = this.ctx = new AudioContext()
      this.master = ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(ctx.destination)
      const makeTrack = (rain: boolean) => {
        const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), volume = ctx.createGain()
        const buffer = ctx.createBuffer(1,ctx.sampleRate * 6,ctx.sampleRate)
        const samples = buffer.getChannelData(0), b = new Float64Array(7)
        let lastOut = 0
        for (let i = 0; i < samples.length; i++) {
          const white = Math.random() * 2 - 1
          if (rain) {
            b[0] = .99886*b[0] + white*.0555179; b[1] = .99332*b[1] + white*.0750759
            b[2] = .969*b[2] + white*.153852; b[3] = .8665*b[3] + white*.3104856
            b[4] = .55*b[4] + white*.5329522; b[5] = -.7616*b[5] - white*.016898
            samples[i] = (b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+white*.5362)*.11
            b[6] = white*.115926
          } else { lastOut = (lastOut + .02*white)/1.02; samples[i] = 3.5*lastOut }
        }
        source.buffer = buffer; source.loop = true
        filter.type = rain ? 'bandpass' : 'lowpass'
        filter.frequency.value = rain ? 800 : 250
        const mod = ctx.createGain()
        mod.gain.value = rain ? .82 : 1
        if (rain) {
          const lfo = ctx.createOscillator(), depth = ctx.createGain()
          lfo.frequency.value = .13; depth.gain.value = .16
          lfo.connect(depth).connect(mod.gain); lfo.start()
        }
        volume.gain.value = 0
        source.connect(filter).connect(mod).connect(volume).connect(this.master!)
        source.start()
        return volume
      }
      this.tracks = { rain: makeTrack(true), brown: makeTrack(false) }
    }
    this.configure(levels)
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }
  configure(levels: Levels) {
    this.levels = levels
    if (!this.ctx || !this.tracks || !this.master) return
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(levels.muted ? 0 : .7,t,.025)
    this.tracks.rain.gain.setTargetAtTime(levels.rain,t,.05)
    this.tracks.brown.gain.setTargetAtTime(levels.brown,t,.05)
  }
  async turn(levels: Levels) {
    if (levels.muted || !levels.turn) return
    await this.activate(levels)
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain()
    const buffer = ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.12),ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i=0;i<samples.length;i++) samples[i] = Math.random()*2-1
    source.buffer = buffer; filter.type = 'bandpass'
    const t = ctx.currentTime
    filter.frequency.setValueAtTime(900,t); filter.frequency.exponentialRampToValueAtTime(2400,t+.12)
    gain.gain.setValueAtTime(.0001,t); gain.gain.exponentialRampToValueAtTime(Math.max(.0001,this.levels.turn*.6),t+.006)
    gain.gain.exponentialRampToValueAtTime(.0001,t+.12)
    source.connect(filter).connect(gain).connect(this.master)
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect() }
    source.start()
  }
  dispose() { if (this.ctx) void this.ctx.close(); this.ctx = undefined; this.master = undefined; this.tracks = undefined }
}
