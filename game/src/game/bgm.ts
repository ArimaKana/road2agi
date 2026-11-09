// Keep one player across menus, rooms and retries so the song never restarts on a scene change.
export class Bgm {
  private audio?: HTMLAudioElement;
  private enabled = true;
  private unlocked = false;

  constructor() {
    document.addEventListener('visibilitychange', this.sync);
    window.addEventListener('pagehide', this.pause);
    window.addEventListener('pageshow', this.sync);
  }

  unlock() {
    this.unlocked = true;
    this.sync();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.sync();
  }

  private pause = () => { this.audio?.pause(); };

  private sync = () => {
    if (!this.enabled || !this.unlocked || document.hidden) { this.pause(); return; }
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'none';
      this.audio.loop = true;
      this.audio.volume = .3;
      this.audio.src = `${import.meta.env.BASE_URL}assets/audio/dangran-keyi-hao-wenti.mp3`;
    }
    // Autoplay can still be refused (for example for a gamepad). Retry on the next user gesture.
    if (this.audio.paused) void this.audio.play().catch(() => {});
  };
}
