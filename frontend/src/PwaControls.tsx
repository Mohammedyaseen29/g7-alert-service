import { useEffect, useState } from 'react';
import { Download, RefreshCw, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './components/ui/button.js';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaControls() {
  const [promptEvent, setPromptEvent] = useState<InstallPrompt | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    const onInstall = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPrompt); };
    const onInstalled = () => setPromptEvent(null);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
  };

  return <>
    {promptEvent && <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-cyan-100 hover:bg-white/10 hover:text-white" onClick={() => { void install(); }}><Download className="size-4" /><span className="hidden sm:inline">Install</span></Button>}
    {(!online || needRefresh) && <div role="status" className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-xl">
      <span className="flex items-center gap-2">{online ? <RefreshCw className="size-4 text-teal-700" /> : <WifiOff className="size-4 text-amber-700" />}{online ? 'A new version is ready.' : 'Offline — live readings are unavailable.'}</span>
      {online && needRefresh && <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setNeedRefresh(false)}>Later</Button><Button type="button" size="sm" onClick={() => { void updateServiceWorker(true); }}>Update</Button></div>}
    </div>}
  </>;
}
