// Popup entry point. Firefox loads this via `action.default_popup` in
// manifest.json when the user clicks the toolbar icon.
//
// The popup is a stateless-on-close surface — Firefox tears it down the
// moment focus leaves it, and rebuilds fresh on the next open. So all
// state lives in `browser.storage.local` / IndexedDB, not in module
// scope here.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import './popup.css';

import { PairingView } from './PairingView';
import { StatsView } from './StatsView';
import { getPairedDevice, type PairedDevice } from '../storage/device';

type BootState =
  | { name: 'checking' }
  | { name: 'unpaired' }
  | { name: 'paired'; device: PairedDevice };

function App(): JSX.Element {
  const [state, setState] = useState<BootState>({ name: 'checking' });

  const refresh = (): void => {
    void getPairedDevice().then((device) => {
      setState(device === null ? { name: 'unpaired' } : { name: 'paired', device });
    });
  };

  useEffect(refresh, []);

  if (state.name === 'checking') {
    return <div class="app-loading">Loading…</div>;
  }
  if (state.name === 'unpaired') {
    return (
      <div class="app">
        <div class="app__title">Focus Tracker</div>
        <PairingView onClaimed={refresh} />
      </div>
    );
  }
  return (
    <div class="app">
      <div class="app__title">Focus Tracker</div>
      <StatsView device={state.device} />
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(<App />, root);
