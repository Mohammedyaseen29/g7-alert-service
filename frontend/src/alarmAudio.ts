let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  context ??= new window.AudioContext();
  return context;
}

export async function unlockAlarmAudio(): Promise<boolean> {
  const audio = getContext();
  if (!audio) return false;
  try {
    if (audio.state === 'suspended') await audio.resume();
  } catch {
    return false;
  }
  return audio.state === 'running';
}

export async function playAlarmBuzzer(): Promise<boolean> {
  const audio = getContext();
  if (!audio || audio.state !== 'running') return false;

  const start = audio.currentTime;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.connect(audio.destination);

  for (let index = 0; index < 3; index += 1) {
    const at = start + index * 0.28;
    const oscillator = audio.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(index % 2 === 0 ? 880 : 660, at);
    oscillator.connect(gain);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.09, at + 0.015);
    gain.gain.setValueAtTime(0.09, at + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    oscillator.start(at);
    oscillator.stop(at + 0.21);
  }

  window.setTimeout(() => gain.disconnect(), 1100);
  return true;
}
