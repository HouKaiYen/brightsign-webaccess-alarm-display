import './display.css';
import { DisplayRenderer } from './renderer';
import { connectDisplayTransport } from './transport';

const root: HTMLElement | null = document.getElementById('display-root');
if (root === null) {
  throw new Error('找不到播放器顯示容器');
}

const renderer: DisplayRenderer = new DisplayRenderer(root);
connectDisplayTransport(
  (state): void => renderer.setState(state),
  (isConnected): void => renderer.setConnectionStatus(isConnected),
);
