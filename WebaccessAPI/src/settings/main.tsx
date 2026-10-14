import { createRoot } from 'react-dom/client';
import SettingsApp from './SettingsApp';
import './settings.css';

const rootElement: HTMLElement | null = document.getElementById('root');
if (rootElement !== null) createRoot(rootElement).render(<SettingsApp />);
