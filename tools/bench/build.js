// Builds tools/tymbal.html: the reference engine and the worklet wrapper inlined into one page,
// plus the test presets. Run: node tools/bench/build.js
const fs = require('fs'), path = require('path');
const d = __dirname, ref = path.join(d, '..', '..', 'reference');
const dsp = [path.join(ref, 'tymbal-engine.js'), path.join(d, 'processor.js')].map(f => fs.readFileSync(f, 'utf8')).join('\n');
const presets = fs.readFileSync(path.join(ref, 'presets.js'), 'utf8');
for (const [name, src] of [['DSP', dsp], ['presets', presets]]) if (/<\/script/i.test(src)) throw new Error(name + ' source contains </script');
const tpl = fs.readFileSync(path.join(d, 'template.html'), 'utf8');
for (const ph of ['/*__DSP__*/', '/*__PRESETS__*/', '/*__PARAMS__*/']) if (tpl.split(ph).length !== 2) throw new Error('placeholder missing: ' + ph);
// the engine's parameter table, so the page's knobs use the same ranges and defaults
const { PARAMS } = require(path.join(ref, 'tymbal-engine.js'));
const out = path.join(d, '..', 'tymbal.html');
fs.writeFileSync(out, tpl.replace('/*__DSP__*/', () => dsp).replace('/*__PRESETS__*/', () => presets)
  .replace('/*__PARAMS__*/', () => 'window.TYMBAL_PARAMS = ' + JSON.stringify(PARAMS) + ';'));
console.log('tools/tymbal.html', Math.round(fs.statSync(out).size / 1024), 'KB');
