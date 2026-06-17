import assert from 'node:assert/strict';
import test from 'node:test';

import { inferTestStrategyForTask } from '../src/test-strategy.js';

test('inferTestStrategyForTask only upgrades to weapp runtime for explicit runtime validation intent', () => {
  const runtimeStrategy = inferTestStrategyForTask({
    title: '微信小程序结果页按钮没反应，直接修一下并验证截图',
  });
  assert.deepEqual(runtimeStrategy.layers, ['integration', 'weapp']);
  assert.equal(runtimeStrategy.scope, 'weapp-runtime');
  assert.ok(runtimeStrategy.evidencePlan.includes('小程序运行态截图'));

  const copyStrategy = inferTestStrategyForTask({
    title: '微信小程序首页会员文案改短一点',
  });
  assert.notDeepEqual(copyStrategy.layers, ['integration', 'weapp']);
  assert.notEqual(copyStrategy.scope, 'weapp-runtime');
});

test('inferTestStrategyForTask treats lightweight visible UI fixes as visual flow', () => {
  const strategy = inferTestStrategyForTask({
    title: '这个间距留着有点多，把卡片宽度增大一些',
  });

  assert.deepEqual(strategy.layers, ['integration', 'e2e']);
  assert.equal(strategy.scope, 'visual-flow');
  assert.match(strategy.evidencePlan, /before\/after|verification-board/);
  assert.match(strategy.upgradeReason, /轻量 UI 可视优化/);
});

test('inferTestStrategyForTask routes single element internal centering to centering-board evidence', () => {
  const strategy = inferTestStrategyForTask({
    title: '这个图标内部不居中，视觉重心有点偏心，需要重新对齐',
  });

  assert.deepEqual(strategy.layers, ['integration', 'e2e']);
  assert.equal(strategy.scope, 'visual-flow');
  assert.match(strategy.evidencePlan, /centering-board/);
  assert.match(strategy.evidencePlan, /视觉重心/);
});
