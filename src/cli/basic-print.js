/*
 * 核心功能
 * 渲染 OpenPrd 基础工作流与初始化相关命令的人类可读输出或 JSON 输出。
 *
 * 输入
 * 接收 validate、status、classify、clarify、capture、interview、playground、learning、init 等结果对象。
 *
 * 输出
 * 向终端输出结构化摘要，或在 `--json` 模式下直出 JSON。
 *
 * 定位
 * 位于 CLI 表现层的基础输出模块，负责相对稳定的 workspace 基础命令呈现。
 *
 * 依赖
 * 仅依赖终端输出和 result 字段契约，不承担业务写入或子进程执行。
 *
 * 维护规则
 * 新增基础工作流结果字段时同步更新文本输出与 JSON 可读性，保持对外提示风格一致。
 */
import { formatProductTypeDisplay, formatTemplatePackDisplay } from '../product-type-copy.js';
import { printOptionalCapabilitySuggestions } from './shared-print.js';

function resolveActiveTemplatePack(ws) {
  return ws.data.currentState?.templatePack ?? ws.data.config?.activeTemplatePack ?? 'base';
}

function printValidation(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.valid) {
    console.log('OpenPrd 校验通过');
    if (report.warnings.length > 0) {
      console.log('警告:');
      for (const warning of report.warnings) {
        console.log(`- ${warning}`);
      }
    }
    return;
  }

  console.log('OpenPrd 校验失败');
  for (const error of report.errors) {
    console.log(`- ${error}`);
  }
  if (report.warnings.length > 0) {
    console.log('警告:');
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printStatus(ws, report, guidance, json) {
  const versionIndex = Array.isArray(ws.data.versionIndex) ? ws.data.versionIndex : [];
  const learningReview = ws.data.config?.learningReview ?? null;
  const projectRelease = ws.data.releaseLedger ?? null;
  const currentRelease = projectRelease?.currentVersion
    ? projectRelease.versions.find((entry) => entry.version === projectRelease.currentVersion) ?? null
    : null;
  const summary = {
    projectRoot: ws.projectRoot,
    workspaceRoot: ws.workspaceRoot,
    schema: ws.data.schema?.name ?? null,
    templatePack: resolveActiveTemplatePack(ws),
    productTypes: ws.data.config?.supportedProductTypes ?? [],
    prdVersion: ws.data.currentState?.prdVersion ?? 0,
    latestVersionId: ws.data.currentState?.latestVersionId ?? versionIndex.at(-1)?.versionId ?? null,
    versionCount: versionIndex.length,
    valid: report.valid,
    errors: report.errors,
    warnings: report.warnings,
    activeEngagementStatus: ws.data.currentState?.status ?? 'unknown',
    scenario: guidance?.clarification?.scenario?.label ?? null,
    userParticipationMode: guidance?.clarification?.scenario?.userParticipation ?? null,
    currentGate: guidance?.gates?.currentGate ?? null,
    upcomingGate: guidance?.gates?.upcomingGate ?? null,
    projectRelease: projectRelease
      ? {
        enabled: projectRelease.enabled,
        currentVersion: currentRelease?.version ?? projectRelease.currentVersion ?? null,
        currentStatus: currentRelease?.status ?? null,
        itemCount: currentRelease?.items?.length ?? 0,
      }
      : null,
    learningReview,
    learningCurrent: ws.data.learningCurrent ?? null,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`工作区: ${summary.workspaceRoot}`);
  console.log(`Schema: ${summary.schema}`);
  console.log(`场景模板: ${formatTemplatePackDisplay(summary.templatePack, { fallback: '待确认' })}`);
  console.log(`支持的产品场景: ${summary.productTypes.length > 0 ? summary.productTypes.map((type) => formatProductTypeDisplay(type, { fallback: type })).join(' / ') : '待确认'}`);
  console.log(`PRD 版本: ${summary.prdVersion}`);
  console.log(`最新版本: ${summary.latestVersionId ?? '无'}`);
  console.log(`版本数量: ${summary.versionCount}`);
  if (summary.projectRelease?.enabled) {
    console.log(`项目版本: ${summary.projectRelease.currentVersion ?? '未设置'}`);
    if (summary.projectRelease.currentStatus) {
      console.log(`项目版本状态: ${summary.projectRelease.currentStatus}`);
    }
    console.log(`版本条目数: ${summary.projectRelease.itemCount}`);
  }
  console.log(`状态: ${summary.activeEngagementStatus}`);
  if (summary.scenario) {
    console.log(`场景: ${summary.scenario}`);
  }
  if (summary.userParticipationMode) {
    console.log(`用户参与模式: ${summary.userParticipationMode}`);
  }
  if (summary.currentGate) {
    console.log(`当前门禁: ${summary.currentGate}`);
  }
  if (summary.upcomingGate) {
    console.log(`后续门禁: ${summary.upcomingGate}`);
  }
  if (summary.learningReview) {
    console.log(`复盘学习模式: ${summary.learningReview.enabled !== false ? '开启' : '关闭'}`);
    console.log(`默认题材: ${summary.learningReview.defaultGenre ?? 'internet-product'}`);
    console.log(`自动打开: ${summary.learningReview.autoOpen !== false ? '是' : '否'}`);
    console.log(`来源范围: ${summary.learningReview.sourceScope ?? 'workspace'}`);
  }
  if (summary.learningCurrent?.packageId) {
    console.log(`最近学习包: ${summary.learningCurrent.packageId}`);
  }
  console.log(`验证: ${summary.valid ? '通过' : '失败'}`);
  if (summary.errors.length > 0) {
    console.log('错误:');
    for (const error of summary.errors) {
      console.log(`- ${error}`);
    }
  }
  if (summary.warnings.length > 0) {
    console.log('警告:');
    for (const warning of summary.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printReleaseResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    console.log('OpenPrd release: 失败');
    for (const error of result.errors ?? []) {
      console.log(`- ${error}`);
    }
    return;
  }

  console.log(`OpenPrd release: ${result.changed ? '已更新' : '当前状态'}`);
  console.log(`版本账本: ${result.releaseLedgerPath}`);
  console.log(`已启用: ${result.summary.enabled ? '是' : '否'}`);
  console.log(`当前项目版本: ${result.summary.currentVersion ?? '未设置'}`);
  if (result.summary.currentStatus) {
    console.log(`版本状态: ${result.summary.currentStatus}`);
  }
  console.log(`版本数量: ${result.summary.versionCount}`);
  console.log(`当前版本条目: ${result.summary.itemCount}`);
  if (result.summary.tag?.name) {
    const tagState = result.summary.tag.localSha
      ? `${result.summary.tag.name} -> ${result.summary.tag.localSha}`
      : result.summary.tag.name;
    console.log(`本地 tag: ${tagState}`);
  }
  if (result.changeSummary?.items?.length > 0) {
    console.log('变化摘要:');
    for (const item of result.changeSummary.items) {
      console.log(`- ${item.sentence}`);
    }
  }
  for (const warning of result.warnings ?? []) {
    console.log(`- ${warning}`);
  }
}

function printClassifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已锁定产品场景: ${formatProductTypeDisplay(result.currentState.productType, { fallback: '待确认' })}`);
  console.log(`场景模板: ${formatTemplatePackDisplay(result.currentState.templatePack, { fallback: '待确认' })}`);
}

function printClarifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const projectFraming = result.intakeReflection?.projectContext?.projectFraming ?? null;

  console.log(`需要澄清: ${result.ws.workspaceRoot}`);
  console.log(`场景: ${result.clarification.scenario.label}`);
  console.log(`用户参与: ${result.clarification.scenario.userParticipation}`);
  console.log(`待确认关键信息: ${result.clarification.missingRequiredFields}`);
  console.log(`待确认问题: ${result.clarification.mustAskUser.length}`);
  if (result.clarifyPresentation) {
    console.log(`澄清呈现: ${result.clarifyPresentation.label}`);
    console.log(`呈现原因: ${result.clarifyPresentation.reason}`);
  }
  console.log('建议先确认的问题:');
  for (const item of result.clarification.mustAskUser) {
    console.log(`- ${item.prompt}`);
  }
  if (projectFraming) {
    console.log('首轮项目画像:');
    console.log(`- 适用对象: ${projectFraming.audience}`);
    console.log(`- 产品形态: ${projectFraming.productShape}`);
    console.log(`- 第一版先做: ${projectFraming.firstSlice}`);
    console.log(`- 暂不处理: ${projectFraming.nonGoals}`);
    console.log(`- 不能破坏: ${projectFraming.guardrails}`);
    console.log(`- 技术落点: ${projectFraming.architectureSignals}`);
    if (projectFraming.riskProbeSummary !== '当前没有明显命中额外风险探针。') {
      console.log(`- 风险探针: ${projectFraming.riskProbeSummary}`);
    }
  }
  if (result.inlineClarification) {
    console.log('对话内澄清提纲:');
    for (const line of result.inlineClarification.lines) {
      console.log(line);
    }
    console.log('无需打开 HTML；请把上面的项目画像、目标、范围、非目标和验收方式压缩给用户确认。');
  }
  if (result.clarification.canInferLater.length > 0) {
    console.log('之后可以再补充或细化:');
    for (const item of result.clarification.canInferLater.slice(0, 5)) {
      console.log(`- ${item.prompt}`);
    }
  }
}

function printCaptureResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.applied?.length > 1) {
    console.log(`已捕获 ${result.applied.length} 个字段`);
    for (const item of result.applied) {
      console.log(`- ${item.field} (${item.source}): ${JSON.stringify(item.value)}`);
    }
  } else {
    console.log(`已捕获 ${result.field}`);
    console.log(`状态 key: ${result.stateKey}`);
    console.log(`来源: ${result.source}`);
    console.log(`值: ${JSON.stringify(result.value)}`);
  }
  if (result.artifactMarkdown) {
    console.log(`来源 artifact markdown: ${result.artifactMarkdown}`);
  }
  console.log(`剩余缺失必填字段: ${result.analysis.missingRequiredFields}`);
}

function printInterviewResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`访谈模式: ${result.productType ?? '未分类'}`);
  console.log(`来源文件: ${result.sourceFiles.join(', ')}`);
  console.log(result.transcript);
}

function printPlaygroundResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已生成 Playground: ${result.snapshot.title}`);
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`Markdown 数据源: ${result.markdownPath}`);
  console.log(`捕获补丁: ${result.patchPath}`);
  console.log(`已打开: ${result.opened ? '是' : '否'}`);
}

function printLearningResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'learning-review-config') {
    console.log(`复盘学习模式: ${result.enabled ? '已开启' : '已关闭'}`);
    console.log(`默认题材: ${result.config?.defaultGenre ?? 'internet-product'}`);
    console.log(`自动打开: ${result.config?.autoOpen !== false ? '是' : '否'}`);
    return;
  }

  if (result.skipped) {
    console.log('复盘学习包: 已跳过');
    console.log(`原因: ${result.reason}`);
    return;
  }

  console.log(`复盘学习包: ${result.packageId}`);
  console.log(`题材: ${result.genre?.label ?? result.packageMeta?.genreLabel ?? '未知'}`);
  if (result.packageMeta?.styleLabel || result.content?.stylePromptPack?.label) {
    console.log(`子风格: ${result.packageMeta?.styleLabel ?? result.content?.stylePromptPack?.label}`);
  }
  console.log(`主题: ${result.content?.topic ?? result.packageMeta?.topic ?? '未知'}`);
  if (result.packageMeta?.authoringStatus) {
    console.log(`写作状态: ${result.packageMeta.authoringStatus}`);
  }
  console.log(`HTML: ${result.packagePaths?.readerHtml ?? '无'}`);
  console.log(`内容合同: ${result.packagePaths?.contentJson ?? '无'}`);
  console.log(`证据清单: ${result.packagePaths?.evidenceManifest ?? '无'}`);
  if (result.packagePaths?.agentPrompt) {
    console.log(`Agent 写作提示: ${result.packagePaths.agentPrompt}`);
  }
  if (result.packagePaths?.agentContext) {
    console.log(`Agent 上下文: ${result.packagePaths.agentContext}`);
  }
  console.log(`已打开: ${result.opened ? '是' : '否'}`);
}

function printInitResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已初始化 OpenPrd 工作区: ${result.ws.workspaceRoot}`);
  console.log(`场景模板: ${formatTemplatePackDisplay(result.currentState.templatePack, { fallback: '待确认' })}`);
  if (result.templatePackGuidance?.message) {
    console.log(`场景确认: ${result.templatePackGuidance.message}`);
  }
  console.log(`已复制种子文件: ${result.created}`);
  if (result.standards) {
    console.log(`标准化文档: ${result.standards.docsRoot}`);
  }
  if (result.agentIntegration) {
    console.log(`Agent 引导: ${result.agentIntegration.ok ? '已启用' : '需修复'} (${result.agentIntegration.tools.join(', ')})`);
    if (result.agentIntegration.hookProfile) {
      console.log(`Hook 模式: ${result.agentIntegration.hookProfile}`);
    }
    printOptionalCapabilitySuggestions(result.agentIntegration.optionalCapabilities);
  }
}

export {
  printValidation,
  printStatus,
  printClassifyResult,
  printClarifyResult,
  printCaptureResult,
  printInterviewResult,
  printPlaygroundResult,
  printLearningResult,
  printInitResult,
  printReleaseResult,
};
