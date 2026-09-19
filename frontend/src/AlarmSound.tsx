import { useCallback, useEffect, useState } from 'react';
import { AudioLines, BellRing, Volume2, VolumeX } from 'lucide-react';
import { api } from './api.js';
import { playAlarmBuzzer, unlockAlarmAudio } from './alarmAudio.js';
import { Button } from './components/ui/button.js';

const SOUND_SETTING = 'g7_alarm_sound';

export function AlarmSound() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(SOUND_SETTING) !== 'off');
  const [ready, setReady] = useState(false);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [statusError, setStatusError] = useState(false);

  const unlock = useCallback(async () => {
    if (enabled && await unlockAlarmAudio()) setReady(true);
  }, [enabled]);

  useEffect(() => { void unlock(); }, [unlock]);

  useEffect(() => {
    if (!enabled || ready) return;
    const handleInteraction = () => { void unlock(); };
    document.addEventListener('pointerdown', handleInteraction, { once: true });
    document.addEventListener('keydown', handleInteraction, { once: true });
    return () => {
      document.removeEventListener('pointerdown', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
  }, [enabled, ready, unlock]);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const alarms = await api.alarms();
        if (!active) return;
        const count = alarms.active.length;
        setActiveCount(count);
        setStatusError(false);
        if (count > 0 && enabled && ready) await playAlarmBuzzer();
      } catch {
        if (active) setStatusError(true);
        // Keep the last known count instead of presenting an API failure as zero alarms.
      }
    };
    void check();
    const timer = window.setInterval(check, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled, ready]);

  const toggle = async () => {
    if (enabled && !ready) {
      setReady(await unlockAlarmAudio());
      return;
    }
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem(SOUND_SETTING, next ? 'on' : 'off');
    if (next) setReady(await unlockAlarmAudio());
  };

  const active = enabled && activeCount !== null && activeCount > 0;
  const label = !enabled
    ? 'Sound muted'
    : !ready
      ? 'Enable sound'
      : statusError && activeCount === null
        ? 'Alarm status unavailable'
        : active
          ? `Alarm sounding (${activeCount})`
          : 'Sound on';
  const description = !enabled
    ? 'Alarm sound is muted'
    : !ready
      ? 'Browser audio is locked; click to unlock'
      : statusError
        ? 'Alarm status poll failed; last known count is retained'
        : 'Alarm sound enabled and browser audio unlocked';
  const Icon = !enabled ? VolumeX : !ready ? AudioLines : active ? BellRing : Volume2;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`h-10 gap-2 rounded-xl px-3 text-xs text-slate-200 hover:bg-white/10 hover:text-white ${active ? 'bg-rose-500/20 text-rose-100 hover:bg-rose-500/30' : ''}`}
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={description}
      title={description}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}
