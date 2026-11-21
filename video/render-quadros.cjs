// Gera quadros de conferência: node render-quadros.cjs <saida> t1 t2 ...
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [out, ...tempos] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, process.env.COMP || 'composicao.html'));
  await p.evaluate(() => window.pronto);
  for (const t of tempos) {
    await p.evaluate((t) => window.render(t), Number(t));
    await p.screenshot({ path: `${out}/q-${t}.jpg`, type: 'jpeg', quality: 80 });
  }
  console.log('erros:', erros);
  await b.close();
})();
