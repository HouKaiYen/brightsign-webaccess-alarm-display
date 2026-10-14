import { createRoot } from 'react-dom/client';
import ManagementApp from './ManagementApp';
import './management.css';

const rootElement: HTMLElement | null = document.getElementById('root');
if (rootElement !== null) createRoot(rootElement).render(<ManagementApp />);
