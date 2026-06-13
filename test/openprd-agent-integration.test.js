import test from 'node:test';
import { buildProcessInvocation } from '../src/codex-runtime.js';

import {
  assert,
  spawnSync,
  fs,
  os,
  path,
  sharp,
  buildReviewExportPayload,
  renderReviewArtifact,
  addBenchmarkWorkspace,
  advanceOpenSpecTaskWorkspace,
  applyGrowthCandidateWorkspace,
  applyOpenPrdChangeWorkspace,
  approveBenchmarkWorkspace,
  archiveOpenPrdChangeWorkspace,
  captureWorkspace,
  checkDevelopmentStandardsWorkspace,
  checkStandardsWorkspace,
  clarifyWorkspace,
  classifyExternalReferenceWorkspace,
  classifyWorkspace,
  diagramWorkspace,
  diffWorkspace,
  doctorWorkspace,
  finishLoopWorkspace,
  fleetWorkspace,
  freezeWorkspace,
  generateLearningReviewWorkspace,
  generateOpenSpecChangeWorkspace,
  handoffWorkspace,
  historyWorkspace,
  initLoopWorkspace,
  initQualityWorkspace,
  initWorkspace,
  interviewWorkspace,
  learnQualityWorkspace,
  listAcceptedSpecsWorkspace,
  listBenchmarkWorkspace,
  listOpenPrdChangesWorkspace,
  listOpenSpecTaskWorkspace,
  main,
  nextLoopWorkspace,
  nextWorkspace,
  observeBenchmarkSourceWorkspace,
  openspecDiscoveryWorkspace,
  planLoopWorkspace,
  playgroundWorkspace,
  promptLoopWorkspace,
  reviewGrowthWorkspace,
  reviewPresentationWorkspace,
  reviewWorkspace,
  runLoopWorkspace,
  runWorkspace,
  setLearningReviewModeWorkspace,
  setupAgentIntegrationWorkspace,
  statusLoopWorkspace,
  synthesizeWorkspaceBase,
  updateAgentIntegrationWorkspace,
  validateOpenSpecChangeWorkspace,
  validateWorkspace,
  verifyBenchmarkWorkspace,
  verifyLoopWorkspace,
  verifyQualityWorkspace,
  visualCompareWorkspace,
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
  checkCodexCliHealth,
  ensureCodexCliReady,
  createRunWorkspace,
  OPENPRD_LITE_WRITE_TOOL_MATCHER,
  OPENPRD_GUARDED_WRITE_TOOL_MATCHER,
  TEST_OPENPRD_HOME,
  hasTomlFeatureKey,
  findOpenPrdHookGroup,
  makeTempProject,
  pathExists,
  readJsonl,
  writeAnswersFile,
  writeConcreteBasicDocs,
  writeSourceManual,
  writeFolderManual,
  writeFakeCodexBin,
  writeLoopProject,
  mergeReviewPresentation,
  validReviewPresentation,
  writeValidReviewPresentation,
  synthesizeWorkspace,
  writeMinimalChange,
} from './helpers/openprd-test-helpers.js';
test('setup enables Codex hooks while preserving user hook groups', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const previousCodexHome = process.env.OPENPRD_CODEX_HOME;
  const previousOpenPrdHome = process.env.OPENPRD_HOME;
  process.env.OPENPRD_CODEX_HOME = codexHome;
  process.env.OPENPRD_HOME = path.join(project, 'openprd-home');
  await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex', 'hooks.json'), JSON.stringify({
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: 'echo user-hook',
          },
        ],
      },
    ],
  }, null, 2) + '\n');

  try {
    const result = await setupAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
    });
    assert.equal(result.ok, true);
    assert.equal(result.initialized, true);
    assert.deepEqual(result.tools, ['codex']);

    const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
    assert.ok(hooks.PostToolUse.some((group) => group.hooks?.some((hook) => hook.command === 'echo user-hook')));
    assert.equal(hooks.PostToolUse.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs'))), false);
    assert.equal(Boolean(hooks.SessionStart?.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs')))), false);
    assert.ok(findOpenPrdHookGroup(hooks.UserPromptSubmit));
    assert.equal(findOpenPrdHookGroup(hooks.PreToolUse)?.matcher, OPENPRD_LITE_WRITE_TOOL_MATCHER);

    const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
    assert.equal(hasTomlFeatureKey(config, 'hooks'), true);
    assert.equal(hasTomlFeatureKey(config, 'codex_hooks'), false);
    assert.ok(config.includes('[[hooks.UserPromptSubmit]]'));
    assert.ok(config.includes('[[hooks.UserPromptSubmit.hooks]]'));
    assert.ok(config.includes('[[hooks.PreToolUse]]'));
    assert.ok(config.includes('[[hooks.PreToolUse.hooks]]'));
    assert.ok(config.includes('[[hooks.Stop]]'));
    assert.ok(config.includes('[[hooks.Stop.hooks]]'));
    assert.ok(config.includes(`matcher = "${OPENPRD_LITE_WRITE_TOOL_MATCHER}"`));
    assert.equal(config.includes('matcher = "*"'), false);
    assert.equal(config.includes('[[hooks.PostToolUse]]'), false);
    const userConfig = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal(hasTomlFeatureKey(userConfig, 'hooks'), true);
    assert.equal(hasTomlFeatureKey(userConfig, 'codex_hooks'), false);
    const manifest = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'install-manifest.json'), 'utf8'));
    assert.equal(manifest.hooks.profile, 'lite');
    assert.deepEqual(manifest.hooks.events, ['UserPromptSubmit', 'PreToolUse', 'Stop']);
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/hooks/openprd-hook.mjs'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.openprd/harness/command-catalog.md'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/skills/openprd-frontend-design/SKILL.md'));
    assert.equal(Array.isArray(manifest.optionalCapabilities), true);
    assert.deepEqual(manifest.optionalCapabilities.map((capability) => capability.id), ['context7', 'deepwiki']);
    assert.ok(manifest.optionalCapabilities.every((capability) => capability.status === 'recommended'));
    assert.ok(manifest.optionalCapabilities.every((capability) => capability.checkedLocations.some((location) => location.path === '.codex/config.toml')));
    const generatedAgents = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
    assert.ok(generatedAgents.includes('openprd dev-check . <file...>'));
    assert.ok(generatedAgents.includes('repo-local skills 和 hooks'));
    assert.ok(generatedAgents.includes('skills/openprd-router/SKILL.md'));
    assert.ok(generatedAgents.includes('.openprd/harness/command-catalog.md'));
    assert.ok(generatedAgents.includes('### Entry Points'));
    assert.ok(generatedAgents.includes('$openprd-requirement-intake'));
    assert.ok(generatedAgents.includes('$openprd-frontend-design'));
    assert.ok(generatedAgents.includes('### Hook-Enforced Gates'));
    assert.ok(generatedAgents.includes('.openprd/design/active/'));
    assert.ok(generatedAgents.includes('.openprd/design/templates/'));
    assert.ok(generatedAgents.includes('openprd design-starter . --starter'));
    assert.ok(generatedAgents.includes('--brief "<页面主题>"'));
    assert.ok(generatedAgents.includes('写清无依赖'));
    assert.ok(generatedAgents.includes('先不要带 `--no-real-images`'));
    assert.ok(generatedAgents.includes('先尝试补首批真实图片'));
    assert.ok(generatedAgents.includes('不要删除 `index.html` 后另起新稿'));
    assert.ok(generatedAgents.includes('即使结构要大改'));
    assert.ok(generatedAgents.includes('facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction'));
    assert.ok(generatedAgents.includes('separate current-task status from workspace-level debt'));
    assert.ok(generatedAgents.includes('when only `feature-coverage` is pending'));
    assert.ok(generatedAgents.includes('secrets-vault'));
    assert.ok(generatedAgents.includes('最小足够验证'));
    assert.ok(generatedAgents.includes('本地小程序运行态验证'));
    assert.ok(generatedAgents.includes('不要为了验证自动重开应用'));
    assert.equal(generatedAgents.includes('weapp-dev-mcp'), false);
    assert.ok(generatedAgents.includes('resolve_library_id -> query_docs'));
    assert.ok(generatedAgents.includes('Codex 原生 Image 2'));
    assert.ok(generatedAgents.includes('imagegen'));
    assert.ok(generatedAgents.includes('验证与创业闭环'));
    assert.ok(generatedAgents.includes('第一批最容易触达的社区或种子用户'));
    assert.ok(generatedAgents.includes('先怎么手工交付'));
    assert.ok(generatedAgents.includes('手工作战卡怎么写'));
    assert.ok(generatedAgents.includes('第一版只做哪一件事'));
    assert.ok(generatedAgents.includes('周末级 MVP'));
    assert.ok(generatedAgents.includes('从第一个客户开始怎么收费'));
    assert.ok(generatedAgents.includes('客户 1 如何打平成本'));
    assert.ok(generatedAgents.includes('你为什么算这个社区里的自己人'));
    assert.ok(generatedAgents.includes('有没有 10 个样本和更强付费信号'));
    assert.ok(generatedAgents.includes('达到什么条件才允许产品化'));
    assert.ok(generatedAgents.includes('增长阶段守什么纪律'));
    assert.ok(generatedAgents.includes('只自动化最重复的一步'));
    assert.ok(generatedAgents.includes('这条路是否可逆'));
    assert.ok(generatedAgents.includes('是不是你愿意长期住进去的业务形态'));
    assert.ok(generatedAgents.includes('独立素材输出（standalone asset）'));
    assert.ok(generatedAgents.includes('候选效果图'));
    assert.ok(generatedAgents.includes('纳入后续效果图/实现截图对比'));
    assert.ok(generatedAgents.includes('openprd learn .'));
    assert.ok(generatedAgents.includes('学习包和阅读器'));
    assert.ok(generatedAgents.includes('期望产物是否需要章节结构'));
    assert.ok(generatedAgents.includes('不要用关键词表触发'));
    assert.ok(generatedAgents.includes('没有参考图时先判断新建界面还是修改既有界面'));
    assert.ok(generatedAgents.includes('task-scoped Markdown/HTML 测试报告路径'));
    assert.ok(generatedAgents.includes('Markdown / HTML 测试报告'));
    assert.equal(generatedAgents.includes('## Skill Routing'), false);
    assert.equal(generatedAgents.includes('## Tool Reality'), false);
    assert.equal(generatedAgents.includes('## Working Principles'), false);
    assert.equal(generatedAgents.includes('### 标准命令'), false);
    assert.equal(generatedAgents.includes('超过 1500 行要判断本轮是否扩大职责'), false);
    assert.equal(generatedAgents.includes('个性化偏好只进入 user-local 范围'), false);
    assert.equal(generatedAgents.includes('## 大量只读扫描调度'), false);
    assert.equal(generatedAgents.includes('spark-code-researcher'), false);
    const generatedRouterSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-router', 'SKILL.md'), 'utf8');
    assert.ok(generatedRouterSkill.includes('.openprd/harness/command-catalog.md'));
    assert.ok(generatedRouterSkill.includes('$openprd-shared'));
    assert.ok(generatedRouterSkill.includes('$openprd-requirement-intake'));
    assert.ok(generatedRouterSkill.includes('$openprd-frontend-design'));
    assert.ok(generatedRouterSkill.includes('$openprd-harness'));
    assert.ok(generatedRouterSkill.includes('$openprd-benchmark-router'));
    assert.ok(generatedRouterSkill.includes('openprd run . --context --message <用户原话>'));
    assert.ok(generatedRouterSkill.includes('不要只跑不带 message 的 `openprd run . --context`'));
    assert.ok(generatedRouterSkill.includes('design-starter -> Patch Mode'));
    assert.ok(generatedRouterSkill.includes('不要用词表决定工具'));
    assert.ok(generatedRouterSkill.includes('用户目标、期望产物、交付阶段和证据缺口'));
    const generatedIntakeSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'SKILL.md'), 'utf8');
    assert.ok(generatedIntakeSkill.includes('## 分流原则'));
    assert.ok(generatedIntakeSkill.includes('不要按关键词判断'));
    assert.ok(generatedIntakeSkill.includes('requirement write path'));
    assert.ok(generatedIntakeSkill.includes('需求判断 / 需求理解 / 功能范围 / 技术方案'));
    assert.ok(generatedIntakeSkill.includes('轻量主句'));
    assert.ok(generatedIntakeSkill.includes('固定示例文案'));
    assert.ok(generatedIntakeSkill.includes('技术部分 | 初步方案 | 主要负责什么'));
    assert.ok(generatedIntakeSkill.includes('现在怎么解决'));
    assert.ok(generatedIntakeSkill.includes('低成本验证'));
    assert.ok(generatedIntakeSkill.includes('什么情况下先停'));
    assert.ok(generatedIntakeSkill.includes('第一批最容易触达的社区或人群'));
    assert.ok(generatedIntakeSkill.includes('怎么手工交付'));
    assert.ok(generatedIntakeSkill.includes('什么真实承诺最能证明'));
    assert.ok(generatedIntakeSkill.includes('default alive'));
    assert.ok(generatedIntakeSkill.includes('forms / lists / CRUD'));
    assert.ok(generatedIntakeSkill.includes('长期住进去的业务形态'));
    assert.ok(generatedIntakeSkill.includes('不要先拿一版 requirement 摘要代替脑暴产物'));
    assert.ok(generatedIntakeSkill.includes('至少要形成 `brainstorm.html`'));
    assert.ok(generatedIntakeSkill.includes('base'));
    assert.ok(generatedIntakeSkill.includes('consumer'));
    assert.ok(generatedIntakeSkill.includes('面向个人消费者场景'));
    assert.ok(generatedIntakeSkill.includes('b2b'));
    assert.ok(generatedIntakeSkill.includes('agent'));
    assert.ok(generatedIntakeSkill.includes('冷启动没有现有界面'));
    assert.ok(generatedIntakeSkill.includes('设计 brief'));
    const generatedIntakeRubric = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'references', 'routing-rubric.md'), 'utf8');
    assert.ok(generatedIntakeRubric.includes('OSS 全量切到 CDN'));
    const generatedIntakeLenses = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'references', 'prd-template-lenses.md'), 'utf8');
    assert.ok(generatedIntakeLenses.includes('共同骨架'));
    assert.ok(generatedIntakeLenses.includes('Human-Agent contract'));
    assert.ok(generatedIntakeLenses.includes('产品化门槛'));
    assert.ok(generatedIntakeLenses.includes('forms / lists / CRUD'));
    assert.ok(generatedIntakeLenses.includes('长期住进去的业务形态'));
    assert.ok(await fs.stat(path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'references', 'startup-validation-lens.md')).then(() => true));
    const generatedCommandCatalog = await fs.readFile(path.join(project, '.openprd', 'harness', 'command-catalog.md'), 'utf8');
    assert.ok(generatedCommandCatalog.includes('openprd clarify .'));
    assert.ok(generatedCommandCatalog.includes('openprd review . --open'));
    assert.ok(generatedCommandCatalog.includes('openprd loop . --run --agent codex|claude --dry-run'));
    assert.ok(generatedCommandCatalog.includes('openprd learn . --topic <text> --open'));
    assert.ok(generatedCommandCatalog.includes('默认先走这条路径'));
    assert.ok(generatedCommandCatalog.includes('章节、证据锚点、图文讲解、检索练习或阅读体验'));
    assert.ok(generatedCommandCatalog.includes('openprd visual-compare . --reference <效果图> --actual <实现截图>'));
    assert.ok(generatedCommandCatalog.includes('openprd visual-compare . --before <修改前截图> --after <修改后截图>'));
    assert.ok(generatedCommandCatalog.includes('openprd visual-compare . --board <board.json>'));
    assert.ok(generatedCommandCatalog.includes('截图实测证据板'));
    assert.ok(generatedCommandCatalog.includes('openprd visual-prepare . --reference <效果图> --grid <列>x<行>'));
    assert.ok(generatedCommandCatalog.includes('$openprd-frontend-design'));
    assert.ok(generatedCommandCatalog.includes('.openprd/design/active/facts-sheet.md'));
    assert.ok(generatedCommandCatalog.includes('.openprd/design/templates/'));
    assert.ok(generatedCommandCatalog.includes('openprd design-starter . --starter <content-home|product-launch|ops-dashboard> --out <index.html>'));
    assert.ok(generatedCommandCatalog.includes('--brief <页面主题> --sections <模块1|模块2|模块3>'));
    assert.ok(generatedCommandCatalog.includes('写清无依赖'));
    assert.ok(generatedCommandCatalog.includes('Patch Mode'));
    assert.ok(generatedCommandCatalog.includes('不要删除 `index.html` 后另起新稿'));
    assert.ok(generatedCommandCatalog.includes('主参考源'));
    assert.ok(generatedCommandCatalog.includes('index.next.html'));
    assert.ok(generatedCommandCatalog.includes('下一步必须出现真实写文件动作'));
    assert.ok(generatedCommandCatalog.includes('只补合同、只下载素材或只写计划'));
    assert.ok(generatedCommandCatalog.includes('3 个异源方向'));
    assert.ok(generatedCommandCatalog.includes('候选效果图'));
    assert.ok(generatedCommandCatalog.includes('contact sheet'));
    assert.ok(generatedCommandCatalog.includes('openprd quality . --verify'));
    assert.ok(generatedCommandCatalog.includes('如果只剩 `feature-coverage`'));
    const generatedBenchmarkSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-benchmark-router', 'SKILL.md'), 'utf8');
    assert.ok(generatedBenchmarkSkill.includes('## Source Map'));
    assert.ok(generatedBenchmarkSkill.includes('Superpowers'));
    assert.ok(generatedBenchmarkSkill.includes('Context7'));
    assert.ok(generatedBenchmarkSkill.includes('不强行对标'));
    assert.ok(generatedBenchmarkSkill.includes('1-3 个最相关来源'));
    assert.ok(generatedBenchmarkSkill.includes('resolve_library_id'));
    assert.ok(generatedBenchmarkSkill.includes('query_docs'));
    assert.ok(generatedBenchmarkSkill.includes('read_wiki_structure'));
    assert.ok(generatedBenchmarkSkill.includes('ask_question'));
    assert.ok(generatedBenchmarkSkill.includes('已确认什么、还缺什么'));
    assert.ok(generatedBenchmarkSkill.includes('slavingia/skills'));
    assert.ok(generatedBenchmarkSkill.includes('Magic Piece of Paper'));
    assert.ok(generatedBenchmarkSkill.includes('first-customer circles'));
    assert.ok(generatedBenchmarkSkill.includes('customer-1 profitability'));
    assert.ok(generatedBenchmarkSkill.includes('10 specific people'));
    assert.ok(generatedBenchmarkSkill.includes('100 paying before launch'));
    assert.ok(generatedBenchmarkSkill.includes('forms and lists / CRUD first'));
    assert.ok(generatedBenchmarkSkill.includes('automate-one-step-at-a-time'));
    assert.ok(generatedBenchmarkSkill.includes('build for today'));
    assert.ok(generatedBenchmarkSkill.includes('avoid irreversible decisions'));
    assert.ok(generatedBenchmarkSkill.includes('spend time before money'));
    assert.ok(generatedBenchmarkSkill.includes('## Evaluation Lenses'));
    const generatedDiscoverySkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-discovery-loop', 'SKILL.md'), 'utf8');
    assert.ok(generatedDiscoverySkill.includes('## 大量只读扫描调度'));
    assert.ok(generatedDiscoverySkill.includes('2 个独立调研执行者 + 1 个审查'));
    assert.ok(generatedDiscoverySkill.includes('spark-code-researcher'));
    const generatedStandardsSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-standards', 'SKILL.md'), 'utf8');
    assert.ok(generatedStandardsSkill.includes('## 文档影响检查'));
    assert.ok(generatedStandardsSkill.includes('openprd dev-check . <file...>'));
    assert.ok(generatedStandardsSkill.includes('研发期代码修改完成后、最终回复前'));
    assert.ok(generatedStandardsSkill.includes('openprd grow . --review'));
    assert.ok(generatedStandardsSkill.includes('自动补齐识别规则'));
    assert.ok(generatedStandardsSkill.includes('收工复盘'));
    assert.ok(generatedStandardsSkill.includes('grow-aware'));
    assert.ok(generatedStandardsSkill.includes('若已有文件说明书'));
    assert.ok(generatedStandardsSkill.includes('CLI 接入面和 API 接入面'));
    const generatedQualitySkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-quality', 'SKILL.md'), 'utf8');
    assert.ok(generatedQualitySkill.includes('HTML 质量评估报告'));
    assert.ok(generatedQualitySkill.includes('必需 EVO 门禁'));
    assert.ok(generatedQualitySkill.includes('openprd grow . --review'));
    assert.ok(generatedQualitySkill.includes('视觉评审证据'));
    assert.ok(generatedQualitySkill.includes('visual-prepare'));
    assert.ok(generatedQualitySkill.includes('visual-compare'));
    assert.ok(generatedQualitySkill.includes('截图实测证据板'));
    assert.ok(generatedQualitySkill.includes('用户目标、信息架构变化、视觉决策成本和验证风险'));
    assert.ok(generatedQualitySkill.includes('新建界面确认实现前 3 方向方案评审已完成'));
    assert.ok(generatedQualitySkill.includes('本次情况 / 计划保留的经验 / 以后怎么复用 / 只保留在当前项目里'));
    const generatedSharedSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-shared', 'SKILL.md'), 'utf8');
    assert.ok(generatedSharedSkill.includes('默认按性价比选方案'));
    assert.ok(generatedSharedSkill.includes('AGENTS.md` 只保留轻量合同'));
    assert.ok(generatedSharedSkill.includes('secrets-vault'));
    assert.ok(generatedSharedSkill.includes('运行态证据'));
    assert.ok(generatedSharedSkill.includes('不要为了验证自动重开应用'));
    assert.ok(generatedSharedSkill.includes('当前环境已配置的小程序本地验证能力'));
    assert.equal(generatedSharedSkill.includes('weapp-dev-mcp'), false);
    assert.ok(generatedSharedSkill.includes('Localizable'));
    assert.ok(generatedSharedSkill.includes('彩色 Mermaid'));
    assert.ok(generatedSharedSkill.includes('不要中途打断当前任务'));
    assert.ok(generatedSharedSkill.includes('README_EN.md'));
    assert.ok(generatedSharedSkill.includes('代码扩展识别这类白名单工具补全'));
    assert.ok(generatedSharedSkill.includes('optionalCapabilities'));
    assert.ok(generatedSharedSkill.includes('非阻断式增强建议'));
    assert.ok(generatedSharedSkill.includes('创业验证闭环'));
    assert.ok(generatedSharedSkill.includes('第一批最容易触达的人群/社区'));
    assert.ok(generatedSharedSkill.includes('手工作战卡'));
    assert.ok(generatedSharedSkill.includes('第一版只做哪一件事'));
    assert.ok(generatedSharedSkill.includes('客户 1 如何打平成本'));
    assert.ok(generatedSharedSkill.includes('你为什么算这个社区里的自己人'));
    assert.ok(generatedSharedSkill.includes('有没有 10 个样本和更强付费信号'));
    assert.ok(generatedSharedSkill.includes('达到什么条件才允许产品化'));
    assert.ok(generatedSharedSkill.includes('增长阶段守什么纪律'));
    assert.ok(generatedSharedSkill.includes('forms / lists / CRUD'));
    assert.ok(generatedSharedSkill.includes('长期住进去'));
    assert.ok(generatedSharedSkill.includes('什么真实承诺才算真需求'));
    assert.ok(generatedSharedSkill.includes('怎样先活下来'));
    assert.ok(generatedSharedSkill.includes('.openprd/design/'));
    assert.ok(generatedSharedSkill.includes('direction-plan.md'));
    const generatedHarnessSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), 'utf8');
    assert.ok(generatedHarnessSkill.includes('AGENTS.md` 只保留轻量合同'));
    assert.ok(generatedHarnessSkill.includes('外部证据不足就直接改第三方集成'));
    assert.ok(generatedHarnessSkill.includes('Context7、DeepWiki'));
    assert.ok(generatedHarnessSkill.includes('可代为补配置'));
    assert.ok(generatedHarnessSkill.includes('创业验证透镜'));
    assert.ok(generatedHarnessSkill.includes('第一批最容易触达的社区或种子用户'));
    assert.ok(generatedHarnessSkill.includes('验证阶段怎样先活下来'));
    assert.ok(generatedSharedSkill.includes('第三方 API、模型、云服务或付费工具'));
    assert.ok(generatedSharedSkill.includes('多个对象、方案、文件、场景、风险、验证项、素材或任务'));
    assert.ok(generatedSharedSkill.includes('方案对比、状态盘点、问题排查、风险审查、多对象 QA'));
    assert.ok(generatedSharedSkill.includes('高置信应可成长'));
    assert.ok(generatedSharedSkill.includes('openprd update .'));
    assert.ok(generatedSharedSkill.includes('左侧标注“效果图”'));
    assert.ok(generatedSharedSkill.includes('候选效果图'));
    assert.ok(generatedSharedSkill.includes('纳入后续对比'));
    assert.ok(generatedSharedSkill.includes('修改前 / 修改后'));
    assert.ok(generatedSharedSkill.includes('普通截图和 Computer/Browser/Playwright 实测截图只能作为原始素材'));
    assert.ok(generatedSharedSkill.includes('先判断新建界面还是修改既有界面'));
    assert.ok(generatedSharedSkill.includes('冷启动没有现有界面'));
    assert.ok(generatedHarnessSkill.includes('代码修改完成后、最终回复前'));
    assert.ok(generatedHarnessSkill.includes('代码扩展识别这类白名单工具补全'));
    assert.ok(generatedHarnessSkill.includes('收工时用 `openprd grow . --review`'));
    assert.ok(generatedHarnessSkill.includes('主动询问用户是否做成可成长配置'));
    assert.ok(generatedHarnessSkill.includes('openprd learn .'));
    assert.ok(generatedHarnessSkill.includes('产物形态'));
    assert.ok(generatedHarnessSkill.includes('不要用关键词表触发'));
    assert.ok(generatedHarnessSkill.includes('普通 Markdown 只能作为辅助讲义'));
    assert.ok(generatedHarnessSkill.includes('冷启动没有现有界面'));
    assert.ok(generatedHarnessSkill.includes('视觉决策成本和验证风险'));
    assert.ok(generatedHarnessSkill.includes('同一张证据板'));
    assert.ok(generatedHarnessSkill.includes('focus-board'));
    assert.ok(generatedHarnessSkill.includes('verification-board'));
    assert.ok(generatedHarnessSkill.includes('候选效果图'));
    assert.ok(generatedHarnessSkill.includes('contact sheet'));
    assert.ok(generatedHarnessSkill.includes('visual-prepare'));
    assert.ok(generatedHarnessSkill.includes('$openprd-frontend-design'));
    assert.ok(generatedHarnessSkill.includes('.openprd/design/active/selected-direction.md'));
    assert.ok(generatedHarnessSkill.includes('至少先产出一份视觉证据图'));
    assert.ok(generatedHarnessSkill.includes('test-reports/<task-id>.html'));
    assert.ok(generatedHarnessSkill.includes('业务和产品语言'));
    assert.ok(generatedHarnessSkill.includes('性价比最优'));
    assert.ok(generatedHarnessSkill.includes('主动使用 Markdown 表格'));
    assert.ok(generatedHarnessSkill.includes('.openprd/harness/visual-reviews/'));
    assert.ok(generatedHarnessSkill.includes('实现截图'));
    assert.ok(generatedHarnessSkill.includes('修改前截图'));
    assert.ok(generatedHarnessSkill.includes('执行确认清单'));
    assert.ok(generatedHarnessSkill.includes('已确认，我按这个继续'));
    assert.ok(generatedHarnessSkill.includes('不能只要求用户回复一句确认'));
    assert.ok(generatedHarnessSkill.includes('先整理需求摘要给你确认'));
    assert.ok(generatedHarnessSkill.includes('你回我一句我就开始实现'));
    assert.ok(generatedHarnessSkill.includes('这条经验只会保留在当前项目里'));
    const generatedCodexHook = await fs.readFile(path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'utf8');
    assert.ok(generatedCodexHook.includes('执行确认清单'));
    assert.ok(generatedCodexHook.includes('期望产物形态'));
    assert.ok(generatedCodexHook.includes('冷启动没有现有界面'));
    assert.ok(generatedCodexHook.includes('新建界面应先完成 3 方向方案评审'));
    assert.ok(generatedCodexHook.includes('已确认，我按这个继续'));
    assert.ok(generatedCodexHook.includes('不要再写“如果你认可”'));
    assert.ok(generatedCodexHook.includes('候选效果图'));
    assert.ok(generatedCodexHook.includes('是否纳入后续效果图/实现截图对比'));
    assert.ok(generatedCodexHook.includes('visual-prepare'));
    assert.ok(generatedCodexHook.includes('contact sheet'));
    assert.ok(generatedCodexHook.includes('至少产出一份 visual-compare / focus-board / parallel-board / verification-board 证据图'));
    assert.ok(generatedCodexHook.includes('截图实测证据板'));
    assert.ok(generatedCodexHook.includes('先整理需求摘要给你确认'));
    assert.ok(generatedCodexHook.includes('你回我一句我就开始实现'));
    assert.ok(generatedCodexHook.includes('这次我观察到一个以后可能重复出现的情况：'));
    assert.ok(generatedCodexHook.includes('这条经验只会保留在当前项目里。'));
    assert.ok(generatedCodexHook.includes('openprd knowledge reject --path . --id'));
    const generatedFrontendSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-frontend-design', 'SKILL.md'), 'utf8');
    assert.equal(generatedFrontendSkill.startsWith('---\n'), true);
    assert.ok(generatedFrontendSkill.includes('Facts Before Assumptions'));
    assert.ok(generatedFrontendSkill.includes('.openprd/design/active/facts-sheet.md'));
    assert.ok(generatedFrontendSkill.includes('.openprd/design/templates/README.md'));
    assert.ok(generatedFrontendSkill.includes('openprd design-starter . --starter <starter-id> --out index.html'));
    assert.ok(generatedFrontendSkill.includes('--brief "<页面主题>"'));
    assert.ok(generatedFrontendSkill.includes('无外部产品事实依赖'));
    assert.ok(generatedFrontendSkill.includes('禁止删除 `index.html` 后另起新稿'));
    assert.ok(generatedFrontendSkill.includes('模板默认组合优先于'));
    assert.ok(generatedFrontendSkill.includes('主参考源'));
    assert.ok(generatedFrontendSkill.includes('index.next.html'));
    assert.ok(generatedFrontendSkill.includes('下一步必须出现真实写文件动作'));
    assert.ok(generatedFrontendSkill.includes('只做规划、下载素材、补合同、写说明或口头承诺'));
    const generatedFrontendDirections = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-frontend-design', 'references', 'direction-engine.md'), 'utf8');
    assert.ok(generatedFrontendDirections.includes('不同思路'));
    assert.ok(generatedFrontendDirections.includes('先不要强行再出 3 个方向'));
    const generatedFrontendAssets = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-frontend-design', 'references', 'design-asset-contract.md'), 'utf8');
    assert.ok(generatedFrontendAssets.includes('asset-spec'));
    assert.ok(generatedFrontendAssets.includes('参考资产'));
    const generatedVisualCommand = await fs.readFile(path.join(project, '.codex', 'prompts', 'openprd-visual-compare.md'), 'utf8');
    assert.ok(generatedVisualCommand.includes('side-by-side JPG'));
    assert.ok(generatedVisualCommand.includes('效果图'));
    assert.ok(generatedVisualCommand.includes('实现截图'));
    assert.ok(generatedVisualCommand.includes('before/after'));
    assert.ok(generatedVisualCommand.includes('--board <board.json>'));
    assert.ok(generatedVisualCommand.includes('candidate references'));
    assert.ok(generatedVisualCommand.includes('visual-prepare'));
    assert.ok(generatedVisualCommand.includes('contact sheet'));
    const generatedPrepareCommand = await fs.readFile(path.join(project, '.codex', 'prompts', 'openprd-visual-prepare.md'), 'utf8');
    assert.ok(generatedPrepareCommand.includes('reference-set'));
    assert.ok(generatedPrepareCommand.includes('contact-sheet.jpg'));
    assert.ok(generatedPrepareCommand.includes('compare-plan.json'));
    const fakeCodexBin = await writeFakeCodexBin(project);

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const previousPathForDoctor = process.env.PATH;
    try {
      process.env.PATH = `${fakeCodexBin}${path.delimiter}${previousPathForDoctor}`;
      assert.equal(await main(['doctor', project, '--tools', 'codex', '--json']), 0);
    } finally {
      process.env.PATH = previousPathForDoctor;
      console.log = originalLog;
    }
    assert.ok(JSON.parse(logs.join('\n')).ok);

    await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
      type: 'module',
      scripts: {
        'test:smoke': 'node --test smoke.test.js',
      },
    }, null, 2)}\n`);
    await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
      version: 1,
      activeChange: null,
      changes: {},
    }, null, 2)}\n`);
    await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), `${JSON.stringify({
      activeChange: null,
      taskSharding: {
        maxItemsPerFile: 25,
        handoffRequired: true,
        firstFile: 'tasks.md',
        nextFilePattern: 'tasks-###.md',
      },
      taskMetadata: {
        stableIdPattern: 'T###.##',
        required: ['done', 'verify'],
        optional: ['deps', 'type'],
        dependencyOrder: 'dependencies must appear before dependents',
      },
    }, null, 2)}\n`);
    await fs.mkdir(path.join(project, 'docs', 'basic'), { recursive: true });
    await writeConcreteBasicDocs(project);
    await fs.mkdir(path.join(project, 'src'), { recursive: true });
    await writeSourceManual(path.join(project, 'src', 'app.js'), 'export const app = true;');
    await writeFolderManual(path.join(project, 'src'), project, 'src');
    await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'setup-smoke.md'), [
      '# EVO setup report',
      '',
      '- smoke: passed setup hook flow',
      '- feature coverage: no active change',
      '',
    ].join('\n'));

    const hookResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'PreToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'git commit -m "test"',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeCodexBin}${path.delimiter}${process.env.PATH}`,
        OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
      },
    });
    assert.equal(hookResult.status, 0);
    const hookPayload = JSON.parse(hookResult.stdout);
    assert.equal(hookPayload.continue, true);
    assert.equal(hookPayload.should_stop, undefined);
    assert.equal(hookPayload.additional_contexts, undefined);
    assert.equal(hookPayload.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(hookPayload.hookSpecificOutput.additionalContext.includes('high-risk gate passed'));

    const lowRiskResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'PreToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'ls',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
      },
    });
    assert.equal(lowRiskResult.status, 0);
    assert.deepEqual(JSON.parse(lowRiskResult.stdout), { continue: true });

    const successPostResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'PostToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'ls',
        },
        tool_response: {
          stdout: 'README.md',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
      },
    });
    assert.equal(successPostResult.status, 0);
    assert.deepEqual(JSON.parse(successPostResult.stdout), { continue: true });

    const sessionStartResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'SessionStart'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        hook_event_name: 'SessionStart',
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
      },
    });
    assert.equal(sessionStartResult.status, 0);
    assert.deepEqual(JSON.parse(sessionStartResult.stdout), { continue: true });

    for (const eventName of ['UserPromptSubmit']) {
      const eventResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), eventName], {
        cwd: project,
        input: JSON.stringify({
          cwd: project,
          hook_event_name: eventName,
          prompt: eventName === 'UserPromptSubmit' ? '继续推进 OpenPrd' : undefined,
        }),
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
        },
      });
      assert.equal(eventResult.status, 0);
      const eventPayload = JSON.parse(eventResult.stdout);
      assert.equal(eventPayload.continue, true);
      assert.equal(eventPayload.should_stop, undefined);
      assert.equal(eventPayload.additional_contexts, undefined);
      assert.equal(eventPayload.hookSpecificOutput.hookEventName, eventName);
      assert.ok(eventPayload.hookSpecificOutput.additionalContext.includes('当前进展参考'));
      assert.ok(eventPayload.hookSpecificOutput.additionalContext.includes('OpenPrd 上下文只是建议'));
      assert.equal(eventPayload.hookSpecificOutput.additionalContext.includes('Follow the recommended OpenPrd run command'), false);
    }
    const events = await fs.readFile(path.join(project, '.openprd', 'harness', 'events.jsonl'), 'utf8');
    assert.ok(events.includes('allowed-high-risk'));
    assert.equal(events.includes('allowed-low-risk'), false);
    assert.equal(events.includes('tool-complete'), false);

    await fs.appendFile(path.join(project, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
    const drifted = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
    assert.equal(drifted.ok, false);
    assert.ok(drifted.agentIntegration.drift.errors.some((error) => error.includes('checksum-drift')));
    const updated = await updateAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
    });
    assert.equal(updated.ok, true);
    const repaired = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.agentIntegration.drift.ok, true);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.OPENPRD_CODEX_HOME;
    } else {
      process.env.OPENPRD_CODEX_HOME = previousCodexHome;
    }
    if (previousOpenPrdHome === undefined) {
      delete process.env.OPENPRD_HOME;
    } else {
      process.env.OPENPRD_HOME = previousOpenPrdHome;
    }
  }
});

test('setup emits Windows-safe Codex hook commands with double-quoted paths', async () => {
  const originalProject = await makeTempProject();
  const project = path.join(path.dirname(originalProject), 'project with spaces');
  const codexHome = path.join(project, 'codex-home');
  const previousCodexHome = process.env.OPENPRD_CODEX_HOME;
  process.env.OPENPRD_CODEX_HOME = codexHome;
  await fs.rename(originalProject, project);

  try {
    const result = await setupAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
      platform: 'win32',
    });
    assert.equal(result.ok, true);

    const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
    const promptGroup = findOpenPrdHookGroup(hooks.UserPromptSubmit);
    assert.ok(promptGroup);
    assert.equal(promptGroup.hooks[0].command.startsWith('node "'), true);
    assert.ok(promptGroup.hooks[0].command.includes('/project with spaces/.codex/hooks/openprd-hook.mjs" UserPromptSubmit'));
    assert.equal(/node '.*openprd-hook\.mjs'/.test(promptGroup.hooks[0].command), false);

    const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
    assert.ok(config.includes('command = "node \\"'));
    assert.ok(config.includes('project with spaces'));
    assert.equal(/node '.*openprd-hook\.mjs'/.test(config), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.OPENPRD_CODEX_HOME;
    } else {
      process.env.OPENPRD_CODEX_HOME = previousCodexHome;
    }
  }
});

test('doctor reports optional capabilities without making them blocking and detects configured locations', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const cursorHome = path.join(project, 'cursor-home');

  await setupAgentIntegrationWorkspace(project, {
    tools: 'all',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
    cursorHome,
  });

  await fs.writeFile(path.join(project, '.cursor', 'mcp.json'), `${JSON.stringify({
    mcpServers: {
      context7: {
        url: 'https://mcp.context7.com/mcp',
      },
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.mcp.json'), `${JSON.stringify({
    mcpServers: {
      deepwiki: {
        url: 'https://mcp.deepwiki.com/mcp',
      },
    },
  }, null, 2)}\n`);

  const doctor = await doctorWorkspace(project, {
    tools: 'all',
    enableUserCodexConfig: true,
    codexHome,
    cursorHome,
  });
  assert.equal(doctor.ok, true);

  const context7 = doctor.agentIntegration.optionalCapabilities.find((capability) => capability.id === 'context7');
  const deepwiki = doctor.agentIntegration.optionalCapabilities.find((capability) => capability.id === 'deepwiki');
  assert.equal(context7?.status, 'configured');
  assert.ok(context7?.configuredLocations.some((location) => location.path === '.cursor/mcp.json'));
  assert.equal(deepwiki?.status, 'configured');
  assert.ok(deepwiki?.configuredLocations.some((location) => location.path === '.mcp.json'));
});


test('clarify treats legacy artifact mode as an inline checklist', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, { mode: 'artifact', open: true });
  assert.equal(clarify.clarifyPresentation.mode, 'inline-with-checklist');
  assert.equal(clarify.clarifyArtifact, null);
  assert.equal(clarify.clarifyArtifactBundle, null);
  assert.equal(clarify.opened, false);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('主要服务对象')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 功能模块 |')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 技术部分 |')));
});

test('doctor fails when Codex hook emits legacy output schema', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  await fs.writeFile(
    path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'),
    'console.log(JSON.stringify({ should_stop: false, additional_contexts: [] }));\n',
  );

  const result = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(result.ok, false);
  assert.ok(result.agentIntegration.checks.some((check) => (
    check.path === '.codex/hooks/openprd-hook.mjs:smoke'
      && check.ok === false
      && check.message.includes('legacy fields')
  )));
});

test('doctor distinguishes unmanaged generated skill files from missing files', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const skillPath = path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'SKILL.md');
  await fs.writeFile(skillPath, '# Local custom intake skill\n');

  const doctor = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(doctor.ok, false);
  const check = doctor.agentIntegration.checks.find((item) => item.path === '.codex/skills/openprd-requirement-intake/SKILL.md');
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'missing-generated-marker');
  assert.ok(check.message.includes('lacks OPENPRD:GENERATED'));
  assert.ok(check.repairHint.includes('openprd update . --force'));
  assert.ok(doctor.errors.some((error) => error.includes('missing-generated-marker') || error.includes('OPENPRD:GENERATED')));

  const update = await updateAgentIntegrationWorkspace(project, {
    tools: 'codex',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(update.ok, false);
  const skipped = update.changes.find((change) => change.path === '.codex/skills/openprd-requirement-intake/SKILL.md');
  assert.equal(skipped.status, 'skipped-user-file');
  assert.equal(skipped.reason, 'missing-generated-marker');
  assert.ok(skipped.repairHint.includes('openprd update . --force'));
  assert.equal(await fs.readFile(skillPath, 'utf8'), '# Local custom intake skill\n');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['doctor', project, '--tools', 'codex']), 1);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('未受管') && line.includes('.codex/skills/openprd-requirement-intake/SKILL.md')));
  assert.ok(logs.some((line) => line.includes('missing-generated-marker')));
  assert.ok(logs.some((line) => line.includes('修复建议') && line.includes('openprd update . --force')));
});

test('setup strips legacy Codex hook feature flags and keeps other feature keys', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex', 'config.toml'), '[features]\nhooks = true\ncodex_hooks = true\nchild_agents_md = true\n');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, 'config.toml'), '[features]\nhooks = true\ncodex_hooks = true\n');

  const result = await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(result.ok, true);

  const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.equal(hasTomlFeatureKey(config, 'hooks'), true);
  assert.ok(config.includes('child_agents_md = true'));
  assert.equal(hasTomlFeatureKey(config, 'codex_hooks'), false);

  const userConfig = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
  assert.equal(hasTomlFeatureKey(userConfig, 'hooks'), true);
  assert.equal(hasTomlFeatureKey(userConfig, 'codex_hooks'), false);
});

test('Codex runtime health diagnoses optional dependency failure without repairing by default', async () => {
  const calls = [];
  const runtime = await ensureCodexCliReady({
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.\nReinstall Codex: npm install -g @openai/codex@latest\n',
      };
    },
  });

  assert.equal(runtime.ok, false);
  assert.equal(runtime.repairAttempted, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { command: 'codex', args: ['--version'] });
  assert.equal(runtime.preflight.diagnostic.type, 'missing-optional-dependency');
  assert.equal(runtime.preflight.diagnostic.missingPackage, '@openai/codex-darwin-arm64');
  assert.equal(runtime.repairCommand.display, 'npm install -g @openai/codex@latest');
  assert.ok(runtime.errors.some((error) => error.includes('--repair-agent')));
});

test('Codex runtime wraps bare Windows commands through cmd.exe for npm shims', () => {
  const invocation = buildProcessInvocation('codex', ['--version'], {
    platform: 'win32',
    env: {
      ...process.env,
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    },
  });

  assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.args, ['/d', '/s', '/c', 'codex --version']);
  assert.equal(invocation.display, 'codex --version');
  assert.equal(invocation.shell, false);
});

test('Codex runtime repair runs explicit npm install and rechecks version', async () => {
  const calls = [];
  const runtime = await ensureCodexCliReady({
    repair: true,
    runCommand: async (command, args) => {
      calls.push({ command, args });
      if (calls.length === 1) {
        return {
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
        };
      }
      if (calls.length === 2) {
        return { ok: true, exitCode: 0, stdout: 'installed\n', stderr: '' };
      }
      return { ok: true, exitCode: 0, stdout: 'codex 0.200.0\n', stderr: '' };
    },
  });

  assert.equal(runtime.ok, true);
  assert.equal(runtime.repairAttempted, true);
  assert.deepEqual(calls, [
    { command: 'codex', args: ['--version'] },
    { command: 'npm', args: ['install', '-g', '@openai/codex@latest'] },
    { command: 'codex', args: ['--version'] },
  ]);
  assert.equal(runtime.repair.ok, true);
  assert.equal(runtime.repair.recheck.version, 'codex 0.200.0');
});

test('doctor checks Codex CLI runtime and only repairs with --fix', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const failed = await doctorWorkspace(project, {
    tools: 'codex',
    checkCodexRuntime: true,
    enableUserCodexConfig: true,
    codexHome,
    codexRunCommand: async () => ({
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
    }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.codexRuntime.preflight.diagnostic.missingPackage, '@openai/codex-darwin-arm64');
  assert.equal(failed.codexRuntime.repairAttempted, false);
  assert.ok(failed.errors.some((error) => error.includes('codex-runtime')));

  const calls = [];
  const repaired = await doctorWorkspace(project, {
    tools: 'codex',
    fix: true,
    checkCodexRuntime: true,
    enableUserCodexConfig: true,
    codexHome,
    codexRunCommand: async (command, args) => {
      calls.push({ command, args });
      if (calls.length === 1) {
        return {
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
        };
      }
      if (calls.length === 2) {
        return { ok: true, exitCode: 0, stdout: 'installed\n', stderr: '' };
      }
      return { ok: true, exitCode: 0, stdout: 'codex 0.200.0\n', stderr: '' };
    },
  });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.codexRuntime.repairAttempted, true);
  assert.equal(repaired.codexRuntime.repair.command.display, 'npm install -g @openai/codex@latest');
  assert.deepEqual(calls.map((call) => call.command), ['codex', 'npm', 'codex']);
});

test('setup can opt into guarded Codex hook profile', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const result = await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    hookProfile: 'guarded',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(result.ok, true);
  assert.equal(result.hookProfile, 'guarded');

  const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(findOpenPrdHookGroup(hooks.UserPromptSubmit));
  assert.equal(findOpenPrdHookGroup(hooks.PreToolUse)?.matcher, OPENPRD_GUARDED_WRITE_TOOL_MATCHER);
  assert.equal(Boolean(hooks.PostToolUse?.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs')))), false);

  const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.ok(config.includes('[[hooks.UserPromptSubmit]]'));
  assert.ok(config.includes('[[hooks.PreToolUse]]'));
  assert.ok(config.includes('[[hooks.Stop]]'));
  assert.ok(config.includes(`matcher = "${OPENPRD_GUARDED_WRITE_TOOL_MATCHER}"`));
  assert.equal(config.includes('[[hooks.PostToolUse]]'), false);

  const manifest = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.hooks.profile, 'guarded');
  assert.deepEqual(manifest.hooks.events, ['UserPromptSubmit', 'PreToolUse', 'Stop']);

  const doctor = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(doctor.agentIntegration.hookProfile, 'guarded');
  assert.equal(doctor.ok, true);
});
