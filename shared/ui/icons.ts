import { t } from '../i18n';

const svg = (box: number, attrs: string, body: string) =>
  `<svg viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${attrs}>${body}</svg>`;

export const ICON = {
  translate: svg(16, 'stroke-width="1.7"', '<path d="M2 4.5h6.5M5.25 3v1.5M7.2 4.5c-.6 2.4-2.2 4.4-4.4 5.8M4.2 6.6c.8 1.7 2.1 3 3.8 3.8M8.6 13.5l2.3-6 2.3 6M9.5 11.4h2.8"/>'),
  locate: svg(16, 'stroke-width="1.6"', '<circle cx="8" cy="8" r="3.6"/><path d="M8 1.5v2.3M8 12.2v2.3M1.5 8h2.3M12.2 8h2.3"/>'),
  pin: svg(16, 'stroke-width="1.6"', '<path d="M6 2.5h4M8 2.5v3M5 5.5h6l1.2 4.5H3.8L5 5.5ZM8 10v3.5"/>'),
  close: svg(10, 'stroke-width="1.8"', '<path d="M2 2l6 6M8 2l-6 6"/>'),
  copy: svg(16, 'stroke-width="1.5"', '<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
  done: svg(16, 'stroke-width="2"', '<path d="m3 8.5 3.2 3L13 4.5"/>'),
  fail: svg(16, 'stroke-width="2"', '<path d="M4 4l8 8M12 4l-8 8"/>'),
  down: svg(10, 'stroke-width="1.6"', '<path d="M2 3.5 5 6.5l3-3"/>'),
  right: svg(10, 'stroke-width="1.6"', '<path d="M3.5 2 6.5 5l-3 3"/>'),
  swap: svg(16, 'stroke-width="1.6"', '<path d="M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10L6 13"/>'),
};

export const COPY_LABEL = `${ICON.copy}<span class="lbl">${t('copy')}</span>`;
