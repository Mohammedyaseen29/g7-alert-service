import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { playAlarmBuzzer, unlockAlarmAudio } from './alarmAudio.js';

const SOUND_SETTING = 'g7_alarm_sound';

export function AlarmSound() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(SOUND_SETTING) !== 'off');
  const [ready, setReady] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

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
        if (count > 0 && enabled && ready) await playAlarmBuzzer();
      } catch {
        if (active) setActiveCount(0);
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

  const label = !enabled ? 'Sound muted' : !ready ? 'Enable sound' : activeCount > 0 ? `Alarm sounding (${activeCount})` : 'Sound on';
  return <button type="button" className={`sound-control ${activeCount > 0 && enabled ? 'active' : ''}`} onClick={toggle} aria-pressed={enabled}>{label}</button>;
}
