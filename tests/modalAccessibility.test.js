import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('modal icon close controls expose Korean accessible names identifying their windows', async () => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const names = [];
    for (const [component, context] of [
      ['SettingsModal', /설정/],
      ['DailyHistoryModal', /캘린더.*통계/],
    ]) {
      const { default: Modal } = await server.ssrLoadModule(`/src/components/${component}.jsx`);
      const html = renderToStaticMarkup(React.createElement(Modal, {
        config: { profiles: [], dailyHistoryByProfile: {} },
        onClose() { throw new Error('Rendering must not close the modal'); },
        onSave() { throw new Error('Rendering must not save settings'); },
      }));
      const iconButton = html.match(/<button\b([^>]*)>\s*<svg\b[^>]*class="[^"]*lucide-x\b/);
      assert.ok(iconButton, `${component} renders its icon close button`);
      assert.match(iconButton[1], /type="button"/);
      const name = iconButton[1].match(/aria-label="([^"]+)"/)?.[1];
      assert.ok(name, `${component} close button has an accessible name`);
      assert.match(name, context);
      assert.match(name, /닫기/);
      names.push(name);
    }
    assert.equal(new Set(names).size, names.length);
  } finally {
    await server.close();
  }
});
