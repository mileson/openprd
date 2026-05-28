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
    learningReview,
    learningCurrent: ws.data.learningCurrent ?? null,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`工作区: ${summary.workspaceRoot}`);
  console.log(`Schema: ${summary.schema}`);
  console.log(`模板包: ${summary.templatePack}`);
  console.log(`产品类型: ${summary.productTypes.join(', ')}`);
  console.log(`PRD 版本: ${summary.prdVersion}`);
  console.log(`最新版本: ${summary.latestVersionId ?? '无'}`);
  console.log(`版本数量: ${summary.versionCount}`);
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

function printClassifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已分类产品类型: ${result.currentState.productType}`);
  console.log(`模板包: ${result.currentState.templatePack}`);
}

function printClarifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

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
  if (result.inlineClarification) {
    console.log('对话内澄清提纲:');
    for (const line of result.inlineClarification.lines) {
      console.log(line);
    }
    console.log('无需打开 HTML；请把上面的目标、范围、非目标和验收方式压缩给用户确认。');
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


function printSynthesizeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已合成 PRD 版本 ${result.snapshot.versionId}`);
  console.log(`标题: ${result.snapshot.title}`);
  console.log(`产品类型: ${result.snapshot.productType ?? '未分类'}`);
  console.log(`摘要指纹: ${result.snapshot.digest}`);
  if (result.workUnitId) {
    console.log(`工作单元: ${result.workUnitId}`);
  }
  if (result.reviewPath ?? result.stableReviewArtifact) {
    console.log(`评审面板: ${result.reviewPath ?? result.stableReviewArtifact}`);
  }
  if (result.reviewEntryPath ?? result.reviewArtifact) {
    console.log(`固定入口: ${result.reviewEntryPath ?? result.reviewArtifact}`);
  }
  console.log(`已打开评审面板: ${result.opened ? '是' : '否'}`);
  if (result.reviewPath ?? result.stableReviewArtifact) {
    console.log('请让用户先评审版本绑定的评审面板；用户确认后，使用页面复制出的带 version/digest/work-unit 的命令记录确认。');
  }
}

function printReviewResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    console.log('PRD 评审状态不可用');
    for (const error of result.errors ?? []) {
      console.log(`- ${error}`);
    }
    return;
  }

  console.log(`PRD 评审状态: ${result.status}`);
  console.log(`版本: ${result.versionId}`);
  if (result.workUnitId) {
    console.log(`工作单元: ${result.workUnitId}`);
  }
  console.log(`HTML 评审面板: ${result.reviewPath ?? result.stableReviewArtifact ?? result.reviewArtifact}`);
  if (result.marked) {
    console.log(`已从 ${result.previousStatus} 更新为 ${result.status}`);
  }
  if (result.opened) {
    console.log('已打开评审面板');
  }
}

function printHistoryResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`版本历史: ${result.ws.workspaceRoot}`);
  for (const entry of result.versions) {
    console.log(`- ${entry.versionId} | ${entry.title} | ${entry.productType ?? '未分类'} | ${entry.createdAt}`);
  }
}

function printDiffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result.diff, null, 2));
    return;
  }

  console.log(`差异 ${result.diff.fromVersionId} -> ${result.diff.toVersionId}`);
  console.log(`变更章节: ${result.diff.changedSections.length > 0 ? result.diff.changedSections.join(', ') : '无'}`);
  for (const change of result.diff.changes) {
    console.log(`- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
  }
}


function printNextResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { recommendation, analysis, workflow, taskGraph } = result;
  console.log(`下一步动作: ${recommendation.nextAction}`);
  if (recommendation.currentGate) {
    console.log(`当前门禁: ${recommendation.currentGate}`);
  }
  if (recommendation.upcomingGate) {
    console.log(`后续门禁: ${recommendation.upcomingGate}`);
  }
  console.log(`原因: ${recommendation.reason}`);
  console.log(`建议命令: ${recommendation.suggestedCommand}`);
  console.log(`完成度: ${analysis.completedRequiredFields}/${analysis.totalRequiredFields}`);
  if (taskGraph?.nextReadyNode) {
    console.log(`下一个就绪节点: ${taskGraph.nextReadyNode}`);
  }
  if (result.diagramState?.needed) {
    console.log(`图表门禁: ${result.diagramState.shouldGateFreeze ? '激活' : '已满足'}`);
    console.log(`建议图表: ${result.diagramState.preferredType}`);
  }
  console.log('工作流:');
  console.log(`  ${workflow.join(' -> ')}`);
  if (recommendation.suggestedQuestions.length > 0) {
    console.log('建议问题:');
    for (const question of recommendation.suggestedQuestions) {
      console.log(`- ${question}`);
    }
  }
}

function printInitResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已初始化 OpenPrd 工作区: ${result.ws.workspaceRoot}`);
  console.log(`模板包: ${result.currentState.templatePack}`);
  console.log(`已复制种子文件: ${result.created}`);
  if (result.standards) {
    console.log(`标准化文档: ${result.standards.docsRoot}`);
  }
  if (result.agentIntegration) {
    console.log(`Agent 引导: ${result.agentIntegration.ok ? '已启用' : '需修复'} (${result.agentIntegration.tools.join(', ')})`);
    if (result.agentIntegration.hookProfile) {
      console.log(`Hook 模式: ${result.agentIntegration.hookProfile}`);
    }
  }
}

function printAgentIntegrationResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd agent ${result.action}: ${result.ok ? '通过' : '需修复'}`);
  console.log(`项目: ${result.projectRoot}`);
  console.log(`工具: ${result.tools.join(', ')}`);
  if (result.hookProfile) {
    console.log(`Hook 模式: ${result.hookProfile}`);
  }
  if (result.initialized) {
    console.log(`已初始化工作区: ${result.init.workspaceRoot}`);
  }
  if (result.standards) {
    console.log(`标准化文档: ${result.standards.docsRoot}`);
  }
  if (result.migration) {
    const changed = result.migration.changes.filter((change) => change.status !== 'unchanged').length;
    console.log(`工作区迁移: ${changed} 项`);
  }
  if (result.registry) {
    console.log(`全局 registry: ${result.registry.status === 'created' ? '已登记' : '已刷新'} (${result.registry.registryPath})`);
  }
  console.log('变更:');
  for (const change of result.changes) {
    console.log(`- ${change.status}: ${change.path}`);
  }
  if (result.doctor?.errors?.length > 0) {
    console.log('待处理:');
    for (const error of result.doctor.errors) {
      console.log(`- ${error}`);
    }
  }
}

function printDoctorResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd doctor: ${result.ok ? '通过' : '失败'}`);
  console.log(`项目: ${result.projectRoot}`);
  console.log(`工具: ${result.tools.join(', ')}`);
  if (result.agentIntegration.hookProfile) {
    console.log(`Hook 模式: ${result.agentIntegration.hookProfile}`);
  }
  console.log(`标准化: ${result.standards.ok ? '通过' : '失败'}`);
  console.log(`工作区验证: ${result.validation.valid ? '通过' : '失败'}`);
  if (result.agentIntegration.drift) {
    console.log(`生成物漂移: ${result.agentIntegration.drift.ok ? '无' : '存在'}`);
  }
  console.log('Agent 集成检查:');
  for (const check of result.agentIntegration.checks) {
      console.log(`- ${check.ok ? '通过' : '缺失'}: ${check.path}`);
  }
  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
}

function printFleetResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const mode = result.dryRun
    ? 'dry-run'
    : Object.entries(result.requestedActions)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ');
  console.log(`OpenPrd fleet: ${result.ok ? '通过' : '需处理'}`);
  console.log(`根目录: ${result.root}`);
  console.log(`模式: ${mode || 'report'}`);
  console.log(`最大深度: ${result.maxDepth}`);
  console.log(`项目: ${result.summary.total}`);
  console.log(`- OpenPrd: ${result.summary.openprd}`);
  console.log(`- Agent-only: ${result.summary.agentConfigured}`);
  console.log(`- Plain: ${result.summary.plain}`);
  console.log(`结果: 计划 ${result.summary.planned}，已更新 ${result.summary.updated}，已接入 ${result.summary.setup}，已检查 ${result.summary.doctored}，已补身份 ${result.summary.backfilled}，已同步 registry ${result.summary.synced}，失败 ${result.summary.failed}，跳过 ${result.summary.skipped}`);
  if (result.registry) {
    console.log(`全局 registry: 已知 ${result.registry.knownTotal}，当前 root 命中 ${result.registry.scopedKnown}，root 外 ${result.registry.outsideRoot}，失效 ${result.registry.stale}`);
  }
  if ((result.summary.healthAttention ?? 0) > 0) {
    console.log(`项目健康: ${result.summary.healthAttention} 个需关注（已报告，不阻断本次更新）`);
  }

  const visibleProjects = result.projects
    .filter((project) => project.category !== 'plain-project' || project.status === 'failed' || (project.healthErrors?.length ?? 0) > 0)
    .slice(0, 50);
  if (visibleProjects.length > 0) {
    console.log('项目明细:');
    for (const project of visibleProjects) {
      console.log(`- ${project.status}: ${project.relativePath} (${project.category}) -> ${project.plannedAction}`);
      if (project.workUnits) {
        console.log(`  工作单元: ${project.workUnits.changedVersions}/${project.workUnits.totalVersions} 个历史版本已覆盖或计划覆盖`);
      }
      for (const error of project.errors.slice(0, 3)) {
        console.log(`  错误: ${error}`);
      }
      for (const error of (project.healthErrors ?? []).slice(0, 3)) {
        console.log(`  需关注: ${error}`);
      }
    }
  }
  const hiddenCount = result.projects.length - visibleProjects.length;
  if (hiddenCount > 0) {
    console.log(`还有 ${hiddenCount} 个 plain/skipped 项目未展开；使用 --json 查看完整明细。`);
  }
  if (result.reportPath) {
    console.log(`报告: ${result.reportPath}`);
  }
}

function printKnowledgeReview(knowledgeReview) {
  if (!knowledgeReview) {
    return;
  }
  if (knowledgeReview.skipped) {
    console.log(`项目经验回顾: 已跳过 (${knowledgeReview.reason})`);
    return;
  }
  if (knowledgeReview.ok === false) {
    console.log(`项目经验回顾: 失败 (${knowledgeReview.errors?.[0] ?? 'unknown'})`);
    return;
  }
  console.log(`项目经验草案: ${knowledgeReview.candidateId}`);
  if (knowledgeReview.summary) {
    console.log(`摘要: ${knowledgeReview.summary}`);
  }
  if (Array.isArray(knowledgeReview.categories) && knowledgeReview.categories.length > 0) {
    console.log(`类别: ${knowledgeReview.categories.join(', ')}`);
  }
  if (knowledgeReview.files?.draftSkill) {
    console.log(`Draft Skill: ${knowledgeReview.files.draftSkill}`);
  }
  if (knowledgeReview.files?.candidateDir) {
    console.log(`诊断候选: ${knowledgeReview.files.candidateDir}`);
  }
  if (knowledgeReview.suggestedLearnCommand) {
    console.log(`Promote: ${knowledgeReview.suggestedLearnCommand}`);
  }
}

function printRunResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'run-record-hook') {
    console.log(`OpenPrd run hook 已记录: ${result.event.eventName} -> ${result.event.outcome}`);
    console.log(`迭代记录: ${result.files.iterations}`);
    return;
  }

  if (result.action === 'run-verify') {
    const taskReady = result.readiness?.taskReady !== false;
    const workspaceReady = result.readiness?.workspaceReady !== false;
    const status = taskReady
      ? (workspaceReady ? '通过' : '当前任务通过，工作区待关注')
      : '当前任务失败';
    console.log(`OpenPrd run verify: ${status}`);
    if (result.readiness) {
      console.log(`任务就绪: ${taskReady ? '是' : '否'}`);
      console.log(`工作区就绪: ${workspaceReady ? '是' : '否'}`);
      if (result.readiness.qualityProductionReady !== null) {
        console.log(`质量门禁: ${result.readiness.qualityProductionReady ? 'production-ready' : '待补证据'}`);
      }
    }
    for (const check of result.checks) {
      const scope = check.scope === 'workspace' ? '工作区' : '任务';
      const detail = check.name === 'quality' && check.productionReady === false
        ? ' (production-ready=false)'
        : '';
      console.log(`- ${check.ok ? '通过' : '失败'}: ${check.name} [${scope}]${detail}`);
    }
    printKnowledgeReview(result.knowledgeReview);
    if (result.warnings.length > 0) {
      console.log('工作区待关注:');
      for (const warning of result.warnings) {
        console.log(`- ${warning}`);
      }
    }
    if (result.errors.length > 0) {
      console.log('错误:');
      for (const error of result.errors) {
        console.log(`- ${error}`);
      }
    }
    return;
  }

  console.log('OpenPrd 运行上下文');
  console.log(`项目: ${result.projectRoot}`);
  console.log(`验证: ${result.validation.valid ? '通过' : '失败'}`);
  if (result.lane?.summary) {
    console.log(`执行流: ${result.lane.summary}`);
  }
  if (result.activeChange) {
    const label = result.recommendation?.type === 'requirement-intake' ? '历史激活变更' : '激活变更';
    console.log(`${label}: ${result.activeChange}`);
  }
  if (result.focus?.changeId && result.focus.changeId !== result.activeChange) {
    console.log(`当前目标变更: ${result.focus.changeId}`);
  }
  if (result.activeRequirementGate) {
    console.log(`当前需求入口: ${result.activeRequirementGate.status ?? 'active'}`);
  }
  if (result.taskSummary) {
    console.log(`任务: ${result.taskSummary.completed}/${result.taskSummary.total} 完成，${result.taskSummary.pending} 待处理，${result.taskSummary.blocked} 阻塞`);
    if (result.taskSummary.implementation) {
      console.log(`实质实现任务: ${result.taskSummary.implementation.completed}/${result.taskSummary.implementation.total} 完成，${result.taskSummary.implementation.pending} 待处理`);
    }
  }
  if (result.discovery) {
    console.log(`持续发现: ${result.discovery.runId} 已覆盖 ${result.discovery.summary.covered}/${result.discovery.summary.total}，待处理 ${result.discovery.summary.pending}`);
  }
  console.log(`下一步类型: ${result.recommendation.type}`);
  console.log(`下一步: ${result.recommendation.title}`);
  console.log(`原因: ${result.recommendation.reason}`);
  console.log(`建议只读命令: ${result.recommendation.command}`);
  if (result.recommendation.preparationCommand || result.recommendation.executionCommand || result.recommendation.commitCommand) {
    console.log('执行门槛: 仅当用户当前明确要求开发、实现、继续任务、深度调研、深度对标、复刻落地或提交时使用；规划、梳理、分析、审查类请求保持只读。');
  }
  if (result.recommendation.preparationCommand) {
    console.log(`准备命令: ${result.recommendation.preparationCommand}`);
  }
  if (result.recommendation.executionCommand) {
    console.log(`执行命令: ${result.recommendation.executionCommand}`);
  }
  if (result.recommendation.commitCommand) {
    console.log(`提交命令: ${result.recommendation.commitCommand}`);
  }
  if (result.recommendation.loop?.worktreeRecommended) {
    console.log('工作区建议: 使用独立 worktree 或等价隔离环境承接单任务 Loop。');
  }
  console.log(`验证命令: ${result.recommendation.verifyCommand}`);
  console.log(`状态文件: ${result.files.runState}`);
}

function printLoopResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'loop-prompt') {
    console.log(`OpenPrd loop 提示词: ${result.ok ? '就绪' : '阻塞'}`);
    if (result.task) {
      console.log(`任务: ${result.task.id} ${result.task.title}`);
      if (result.task.taskHandle) console.log(`任务句柄: ${result.task.taskHandle}`);
    }
    if (result.promptPath) {
      console.log(`提示词: ${result.promptPath}`);
    }
    if (result.invocation?.display) {
      console.log(`执行: ${result.invocation.display}`);
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'loop-run') {
    console.log(`OpenPrd loop 运行: ${result.ok ? '通过' : '失败'}${result.dryRun ? ' (dry-run)' : ''}`);
    if (result.task) console.log(`任务: ${result.task.id} ${result.task.title}`);
    if (result.task?.taskHandle) console.log(`任务句柄: ${result.task.taskHandle}`);
    if (result.promptPath) console.log(`提示词: ${result.promptPath}`);
    if (result.invocation?.display) console.log(`执行: ${result.invocation.display}`);
    if (result.finish?.commit) {
      console.log(`提交: ${result.finish.commit.skipped ? '跳过' : result.finish.commit.sha}`);
    }
    if (result.finish?.testReport) {
      console.log(`测试报告: ${result.finish.testReport}`);
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'loop-finish') {
    console.log(`OpenPrd loop finish: ${result.ok ? '通过' : '失败'}`);
    if (result.task) console.log(`任务: ${result.task.id} ${result.task.title}`);
    if (result.task?.taskHandle) console.log(`任务句柄: ${result.task.taskHandle}`);
    if (result.commit) console.log(`提交: ${result.commit.skipped ? '跳过' : result.commit.sha}`);
    if (result.testReport) console.log(`测试报告: ${result.testReport}`);
    if (result.learningReview) {
      if (result.learningReview.skipped) {
        console.log(`复盘学习包: 已跳过 (${result.learningReview.reason})`);
      } else if (result.learningReview.ok === false) {
        console.log(`复盘学习包: 生成失败 (${result.learningReview.errors?.[0] ?? 'unknown'})`);
      } else {
        console.log(`复盘学习包: ${result.learningReview.packageId}`);
        console.log(`HTML: ${result.learningReview.packagePaths?.readerHtml ?? '无'}`);
        console.log(`题材: ${result.learningReview.genre?.label ?? '未知'}`);
        if (result.learningReview.packageMeta?.styleLabel) console.log(`子风格: ${result.learningReview.packageMeta.styleLabel}`);
        if (result.learningReview.packageMeta?.authoringStatus) console.log(`写作状态: ${result.learningReview.packageMeta.authoringStatus}`);
        if (result.learningReview.packagePaths?.agentPrompt) console.log(`Agent 写作提示: ${result.learningReview.packagePaths.agentPrompt}`);
        console.log(`已打开: ${result.learningReview.opened ? '是' : '否'}`);
      }
    }
    printKnowledgeReview(result.knowledgeReview);
    if (result.next) {
      console.log(`下一任务: ${result.next.id} ${result.next.title}`);
      if (result.next.taskHandle) console.log(`下一任务句柄: ${result.next.taskHandle}`);
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  console.log(`OpenPrd loop: ${result.action} ${result.ok ? '通过' : '失败'}`);
  if (result.changeId) console.log(`变更: ${result.changeId}`);
  if (result.summary) {
    console.log(`任务: ${result.summary.done}/${result.summary.total} 完成，${result.summary.pending} 待处理，${result.summary.failed} 失败，${result.summary.blocked} 阻塞`);
  }
  if (result.next) {
    console.log(`下一任务: ${result.next.id} ${result.next.title}`);
    if (result.next.taskHandle) console.log(`下一任务句柄: ${result.next.taskHandle}`);
  }
  if (result.files) {
    console.log(`任务清单: ${result.files.featureList}`);
  }
  if (result.errors?.length) {
    for (const error of result.errors) console.log(`- ${error}`);
  }
}

function printStandardsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'init') {
    console.log(`已初始化 OpenPrd standards: ${result.docsRoot}`);
    for (const item of result.changed) {
      console.log(`- ${item.status}: ${item.path}`);
    }
    return;
  }
  if (result.action === 'classify-external-reference') {
    console.log(`已归类外部参考源码: ${result.path}`);
    console.log(`配置: ${result.configPath}`);
    console.log(`状态: ${result.alreadyPresent ? '已存在' : '已写入'}`);
    return;
  }

  console.log(`OpenPrd standards: ${result.ok ? '通过' : '失败'}`);
  console.log(`Docs root: ${result.docsRoot}`);
  for (const check of result.checks) {
    console.log(`- ${check}`);
  }
  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log('警告:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
  const candidates = result.manualReport?.externalReferenceCandidates ?? [];
  if (candidates.length > 0) {
    console.log('外部参考源码候选:');
    console.log('请先询问用户这些目录是否只作为外部参考；用户确认后再运行归类命令。');
    for (const candidate of candidates) {
      console.log(`- ${candidate.path}: ${candidate.missingFiles} 个文件、${candidate.missingFolders} 个文件夹缺说明书；原因: ${candidate.reason}；建议确认后运行 ${candidate.suggestedCommand}`);
    }
  }
}

function printDevelopmentStandardsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd dev-check: ${result.ok ? '完成' : '失败'}`);
  console.log(`阈值: ≤${result.thresholds.okMax} 行 ok，${result.thresholds.okMax + 1}-${result.thresholds.attentionMax} 行需注意，>${result.thresholds.warningAbove} 行警告。`);
  for (const file of result.files) {
    const lineText = file.lineCount === null || file.lineCount === undefined ? '未知行数' : `${file.lineCount} 行`;
    console.log(`- ${file.status}: ${file.path} (${lineText})`);
    console.log(`  ${file.nextAction}`);
  }
  printKnowledgeReview(result.knowledgeReview);
  for (const error of result.errors ?? []) {
    console.log(`- ${error}`);
  }
}

function growthCandidateStatusLabel(status) {
  if (status === 'applied') return '已应用';
  if (status === 'rejected') return '已拒绝';
  return '待确认';
}

function growthCandidateScopeLabel(scope) {
  if (scope === 'user-local') return '当前用户本地偏好';
  if (scope === 'openprd-core') return 'OpenPrd 核心规则';
  return '项目共享规则';
}

function formatGrowthConfidence(confidence) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return '未提供';
  }
  return `${Math.round(confidence * 100)}%`;
}

function describeGrowthCandidateImpact(candidate) {
  if (candidate.type === 'code-extension') {
    return `会把匹配 ${candidate.key} 的文件纳入代码文件规则，影响当前项目后续同类文件的 dev-check 判断。`;
  }
  if (candidate.type === 'exempt-path-segment') {
    return `会把路径片段 ${candidate.key} 加入代码行数规则豁免，影响对应目录下文件的 dev-check 判断。`;
  }
  if (candidate.type === 'exempt-file-pattern') {
    return `会把文件模式 ${candidate.key} 加入代码行数规则豁免，影响命中的文件。`;
  }
  if (candidate.type === 'user-preference') {
    return `会把偏好 ${candidate.key} 写入当前用户本地配置，不进入项目共享规则。`;
  }
  if (candidate.scope === 'openprd-core') {
    return '采纳后会进入 OpenPrd 核心规则，请确认是否值得作为跨项目默认行为。';
  }
  return `采纳后会写入${growthCandidateScopeLabel(candidate.scope)}，请确认这是否是你想要固化的范围。`;
}

function formatGrowthEvidenceItem(item = {}) {
  if (typeof item === 'string') {
    return item;
  }
  const parts = [];
  if (item.path) {
    parts.push(String(item.path));
  }
  if (item.lineCount !== null && item.lineCount !== undefined) {
    parts.push(`${item.lineCount} 行`);
  }
  if (item.reason) {
    parts.push(`原因: ${item.reason}`);
  }
  if (item.note) {
    parts.push(`说明: ${item.note}`);
  }
  return parts.length > 0 ? parts.join('；') : JSON.stringify(item);
}

function formatGrowthSuggestedPatch(patch) {
  if (!patch) {
    return '未提供';
  }
  if (typeof patch === 'string') {
    return patch;
  }
  const file = patch.file ? String(patch.file) : 'unknown-file';
  const pathText = patch.path ? String(patch.path) : 'unknown-path';
  const op = patch.op ? String(patch.op) : 'update';
  const value = patch.value === undefined ? '' : ` ${JSON.stringify(patch.value)}`;
  return `${file} -> ${pathText} ${op}${value}`.trim();
}

function printGrowthResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'growth-init') {
    console.log('OpenPrd growth: 已初始化');
    console.log(`候选队列: ${result.files.candidates}`);
    return;
  }

  console.log(`OpenPrd growth: ${result.ok ? '完成' : '失败'}`);
  if (result.summary) {
    console.log(`候选: ${result.summary.pending} 待确认，${result.summary.applied} 已应用，${result.summary.rejected} 已拒绝。`);
  }
  const candidates = result.pending ?? (result.candidate ? [result.candidate] : []);
  for (const candidate of candidates) {
    console.log(`- ${candidate.id}: ${candidate.title}`);
    console.log(`  状态: ${growthCandidateStatusLabel(candidate.status)}`);
    console.log(`  作用范围: ${growthCandidateScopeLabel(candidate.scope)}`);
    console.log(`  置信度: ${formatGrowthConfidence(candidate.confidence)}`);
    if (candidate.summary) {
      console.log(`  摘要: ${candidate.summary}`);
    }
    console.log(`  采纳影响: ${describeGrowthCandidateImpact(candidate)}`);
    if ((candidate.evidence ?? []).length > 0) {
      console.log('  证据:');
      for (const evidence of candidate.evidence) {
        console.log(`    - ${formatGrowthEvidenceItem(evidence)}`);
      }
    }
    if (candidate.suggestedPatch) {
      console.log('  拟写入:');
      console.log(`    - ${formatGrowthSuggestedPatch(candidate.suggestedPatch)}`);
    }
    if (candidate.status === 'pending') {
      console.log(`  采纳命令: openprd grow . --apply --id ${candidate.id}`);
      console.log(`  拒绝命令: openprd grow . --reject --id ${candidate.id}`);
    }
  }
  for (const change of result.changed ?? []) {
    console.log(`- 已更新: ${change}`);
  }
  const shouldSkipNextActions = candidates.some((candidate) => candidate.status === 'pending');
  for (const action of shouldSkipNextActions ? [] : (result.nextActions ?? [])) {
    console.log(`- 下一步: ${action}`);
  }
  for (const error of result.errors ?? []) {
    console.log(`- ${error}`);
  }
}

function printQualityResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'quality-init') {
    console.log(`OpenPrd quality: 已初始化 (${result.changed})`);
    console.log(`配置: ${result.files.config}`);
    console.log(`报告目录: ${result.files.reportsDir}`);
    console.log(`知识库索引: ${result.files.knowledgeIndex}`);
    return;
  }

  if (result.action === 'quality-learn') {
    console.log(`OpenPrd quality learn: ${result.ok ? '已沉淀' : '失败'}`);
    if (result.ok) {
      console.log(`来源类型: ${result.sourceKind}`);
      console.log(`来源: ${result.sourcePath}`);
      if (Array.isArray(result.sourcePaths) && result.sourcePaths.length > 1) {
        console.log(`证据数: ${result.sourcePaths.length}`);
      }
      console.log(`事故: ${result.files.incident}`);
      console.log(`模式: ${result.files.pattern}`);
      console.log(`经验 Skill: ${result.files.skill}`);
      return;
    }
    for (const error of result.errors ?? []) {
      console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'quality-knowledge-review') {
    console.log('OpenPrd quality review: 已完成');
    printKnowledgeReview(result);
    return;
  }

  console.log(`OpenPrd quality: ${result.ok ? '完成' : '失败'}`);
  if (result.report) {
    console.log(`质量状态: ${result.report.summary.status}`);
    console.log(`生产就绪: ${result.report.readiness.productionReady ? '是' : '否'}`);
    console.log(`执行模式: ${result.report.readiness.enforcement}`);
    if (result.report.qualityPolicy) {
      console.log(`场景标签: ${result.report.qualityPolicy.scenarioTags.join(', ')}`);
      console.log(`必需门禁: ${result.report.qualityPolicy.requiredGates.join(', ') || '无'}`);
    }
    if (result.report.readiness.attentionGates.length > 0) {
      console.log(`需关注门禁: ${result.report.readiness.attentionGates.join(', ')}`);
    }
    console.log('门禁:');
    for (const gate of result.report.gates) {
      const scope = gate.required ? '必需' : '可选';
      const evidence = gate.evidence?.present ? `证据 ${gate.evidence.sources.length}` : '缺证据';
      console.log(`- ${gate.status}: ${gate.label} (${scope}, ${evidence})`);
    }
  }
  if (result.reportPath) {
    console.log(`JSON: ${result.reportPath}`);
  }
  if (result.htmlPath) {
    console.log(`HTML: ${result.htmlPath}`);
  }
  printKnowledgeReview(result.knowledgeReview);
  for (const error of result.errors ?? []) {
    console.log(`- ${error}`);
  }
}

function printVisualCompareResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('OpenPrd visual compare: 已生成');
  console.log(`输出图片: ${result.outputPath}`);
  console.log(`格式: ${result.format}${result.quality ? `, quality=${result.quality}` : ''}`);
  console.log(`画布: ${result.canvas.width}x${result.canvas.height}`);
  console.log(`左侧: ${result.labels.reference} (${result.reference.rendered.width}x${result.reference.rendered.height})`);
  console.log(`右侧: ${result.labels.actual} (${result.actual.rendered.width}x${result.actual.rendered.height})`);
  for (const action of result.nextActions ?? []) {
    console.log(`- 下一步: ${action}`);
  }
}

function printFreezeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已 freeze OpenPrd 工作区: ${result.ws.workspaceRoot}`);
  console.log(`版本: ${result.snapshot.latestVersionId}`);
  console.log(`Digest: ${result.snapshot.digest}`);
  console.log(`状态文件: ${result.ws.paths.freezeState}`);
}

function printDiagramResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.snapshot) {
    console.log(`已为 ${result.snapshot.title} 生成${result.type === 'product-flow' ? '产品流程' : '架构'}图`);
  } else {
    console.log(`已更新${result.type === 'product-flow' ? '产品流程' : '架构'}图`);
  }
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Mermaid: ${result.mermaidPath}`);
  if (result.inputPath) {
    console.log(`输入 contract: ${result.inputPath}`);
  }
  if (result.marked) {
    console.log(`评审状态: ${result.marked}`);
  } else if (result.model?.metadata?.reviewStatus) {
    console.log(`评审状态: ${result.model.metadata.reviewStatus}`);
  }
  console.log(`已打开: ${result.opened ? '是' : '否'}`);
}

function printHandoffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`交接包已写入: ${result.exportDir}`);
  console.log(`目标: ${result.handoff.target}`);
  console.log(`版本: ${result.handoff.versionId}`);
  console.log(`Digest: ${result.handoff.digest}`);
}

function printOpenSpecDiscoveryResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd discovery 运行: ${result.runId}`);
  if (result.advanced) {
    console.log(`已推进条目: ${result.advancedItem.id}`);
    console.log(`条目状态: ${result.advancedItem.status}`);
    if (result.claim) {
      console.log(`Claim: ${result.claim.id}`);
    }
  }
  if (result.verified) {
    console.log(`验证: ${result.verification.valid ? '通过' : '失败'}`);
    console.log(`完成: ${result.verification.complete ? '是' : '否'}`);
    for (const check of result.verification.checks) {
      console.log(`- ${check}`);
    }
    if (result.verification.errors.length > 0) {
      console.log('错误:');
      for (const error of result.verification.errors) {
        console.log(`- ${error}`);
      }
    }
    if (result.verification.warnings.length > 0) {
      console.log('警告:');
      for (const warning of result.verification.warnings) {
        console.log(`- ${warning}`);
      }
    }
  }
  console.log(`是否恢复: ${result.resumed ? '是' : '否'}`);
  console.log(`运行目录: ${result.runDir}`);
  console.log(`模式: ${result.control.mode}`);
  console.log(`状态: ${result.control.status}`);
  console.log(`已索引来源文件: ${result.inventory.summary.files}`);
  console.log(`覆盖待处理: ${result.coverageMatrix.summary.pending}/${result.coverageMatrix.summary.total}`);
  console.log(`下一步动作: ${result.control.nextAction}`);
}

function printOpenSpecChangeValidationResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd change 验证: ${result.valid ? '通过' : '失败'}`);
  console.log(`Change: ${result.changeId}`);
  for (const check of result.checks) {
    console.log(`- ${check}`);
  }
  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log('警告:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printOpenSpecGenerateResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已生成 OpenPrd change: ${result.changeId}`);
  console.log(`Capability: ${result.capability}`);
  console.log(`任务数: ${result.taskCount}`);
  console.log(`验证: ${result.validation.valid ? '通过' : '失败'}`);
  console.log('文件:');
  for (const file of result.files) {
    console.log(`- ${file}`);
  }
  if (result.validation.errors.length > 0) {
    console.log('错误:');
    for (const error of result.validation.errors) {
      console.log(`- ${error}`);
    }
  }
}

function printOpenSpecTaskResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd 任务: ${result.changeId}`);
  if (result.action === 'list') {
    console.log(`进度: ${result.summary.completed}/${result.summary.total} 已完成，${result.summary.pending} 待处理，${result.summary.blocked} 阻塞`);
    if (result.summary.implementation) {
      console.log(`实质实现任务: ${result.summary.implementation.completed}/${result.summary.implementation.total} 已完成，${result.summary.implementation.pending} 待处理`);
    }
    if (result.nextTask) {
      console.log(`下一任务: ${result.nextTask.id} ${result.nextTask.title}`);
      console.log(`验证命令: ${result.nextTask.metadata.verify}`);
    } else {
      console.log('下一任务: 无');
    }
    if (result.blockedTasks.length > 0) {
      console.log('阻塞任务:');
      for (const task of result.blockedTasks.slice(0, 10)) {
        console.log(`- ${task.id}: ${[...task.missing, ...task.incomplete].join(', ')}`);
      }
    }
    return;
  }

  console.log(`任务: ${result.task.id} ${result.task.title}`);
  if (result.verification) {
    console.log(`验证: ${result.verification.ok ? '通过' : '失败'} (${result.verification.command})`);
    if (!result.verification.ok && result.verification.stderr) {
      console.log(result.verification.stderr.trim());
    }
  }
  if (result.action === 'advance') {
    console.log(`已推进: ${result.advanced ? '是' : '否'}`);
    if (result.summary) {
      console.log(`进度: ${result.summary.completed}/${result.summary.total} 已完成`);
    }
    if (result.nextTask) {
      console.log(`下一任务: ${result.nextTask.id} ${result.nextTask.title}`);
    }
  }
}

function printOpenPrdChangesResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd changes: ${result.changes.length}`);
  console.log(`当前激活 change: ${result.activeChange ?? '无'}`);
  for (const change of result.changes) {
    const marker = change.active ? '*' : '-';
    console.log(`${marker} ${change.id} | ${change.status} | ${change.source} | 任务 ${change.taskTotal - change.taskIncomplete}/${change.taskTotal}`);
  }
}

function printOpenPrdChangeActionResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd change ${result.action}: ${result.changeId}`);
  if (result.action === 'apply') {
    console.log(`已应用: ${result.ok ? '是' : '否'}`);
    if (result.appliedSpecs?.length > 0) {
      console.log('已接受 specs:');
      for (const spec of result.appliedSpecs) {
        console.log(`- ${spec.capability}: ${spec.specPath}`);
      }
    }
    if (result.errors?.length > 0) {
      console.log('错误:');
      for (const error of result.errors) {
        console.log(`- ${error}`);
      }
    }
  }
  if (result.action === 'archive') {
    console.log(`归档目录: ${result.archiveDir}`);
    console.log(`已移除来源: ${result.removedSource ? '是' : '否'}`);
  }
  if (result.action === 'activate') {
    console.log(`当前激活 change: ${result.changeId}`);
  }
}

function printAcceptedSpecsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已接受 specs: ${result.specs.length}`);
  for (const spec of result.specs) {
    const source = spec.metadata?.sourceChange ? ` 来自 ${spec.metadata.sourceChange}` : '';
    console.log(`- ${spec.capability}${source}: ${spec.specPath}`);
  }
  console.log(`已应用 changes: ${result.appliedChanges.length}`);
}

function printBenchmarkResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'benchmark-add') {
    console.log(`OpenPrd benchmark add: ${result.ok ? '已加入 candidate' : '失败'}`);
    if (result.source) {
      console.log(`ID: ${result.source.id}`);
      console.log(`标题: ${result.source.title}`);
      console.log(`来源: ${result.source.url ?? result.source.path ?? 'unknown'}`);
      console.log(`场景: ${result.source.scenarios.join(', ') || '未分类'}`);
    }
    if (result.error) {
      console.log(`错误: ${result.error}`);
    }
    return;
  }

  if (result.action === 'benchmark-approve') {
    console.log('OpenPrd benchmark approve: 已加入 approved registry');
    console.log(`ID: ${result.source.id}`);
    console.log(`标题: ${result.source.title}`);
    console.log(`已批准来源: ${result.counts.approved}`);
    console.log(`待确认来源: ${result.counts.candidates}`);
    return;
  }

  if (result.action === 'benchmark-verify') {
    console.log(`OpenPrd benchmark verify: ${result.ok ? '通过' : '失败'}`);
    for (const check of result.checks) {
      console.log(`- ${check.ok ? '通过' : '失败'}: ${check.id}`);
      for (const issue of check.issues) {
        console.log(`  ${issue.level === 'error' ? '错误' : '警告'}: ${issue.message}`);
      }
    }
    return;
  }

  console.log(`OpenPrd benchmark list: approved ${result.counts.approved}, candidate ${result.counts.candidates}`);
  for (const source of result.approved) {
    console.log(`- approved ${source.id}: ${source.title}`);
  }
  for (const source of result.candidates) {
    console.log(`- candidate ${source.id}: ${source.title}`);
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
  printSynthesizeResult,
  printReviewResult,
  printHistoryResult,
  printDiffResult,
  printNextResult,
  printInitResult,
  printAgentIntegrationResult,
  printDoctorResult,
  printFleetResult,
  printRunResult,
  printLoopResult,
  printStandardsResult,
  printDevelopmentStandardsResult,
  printGrowthResult,
  printQualityResult,
  printVisualCompareResult,
  printFreezeResult,
  printDiagramResult,
  printHandoffResult,
  printOpenSpecDiscoveryResult,
  printOpenSpecChangeValidationResult,
  printOpenSpecGenerateResult,
  printOpenSpecTaskResult,
  printOpenPrdChangesResult,
  printOpenPrdChangeActionResult,
  printAcceptedSpecsResult,
  printBenchmarkResult
};
