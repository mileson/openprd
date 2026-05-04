function resolveActiveTemplatePack(ws) {
  return ws.data.currentState?.templatePack ?? ws.data.config?.activeTemplatePack ?? 'base';
}

function printValidation(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.valid) {
    console.log('OpenPrd validation passed');
    if (report.warnings.length > 0) {
      console.log('Warnings:');
      for (const warning of report.warnings) {
        console.log(`- ${warning}`);
      }
    }
    return;
  }

  console.log('OpenPrd validation failed');
  for (const error of report.errors) {
    console.log(`- ${error}`);
  }
  if (report.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printStatus(ws, report, guidance, json) {
  const versionIndex = Array.isArray(ws.data.versionIndex) ? ws.data.versionIndex : [];
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
  console.log(`缺少必填字段: ${result.clarification.missingRequiredFields}`);
  console.log('需要询问用户:');
  for (const item of result.clarification.mustAskUser) {
    console.log(`- ${item.prompt}`);
  }
  if (result.clarification.canInferLater.length > 0) {
    console.log('之后可以推断或细化:');
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


function printSynthesizeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已合成 PRD 版本 ${result.snapshot.versionId}`);
  console.log(`标题: ${result.snapshot.title}`);
  console.log(`产品类型: ${result.snapshot.productType ?? '未分类'}`);
  console.log(`Digest: ${result.snapshot.digest}`);
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

  console.log(`Diff ${result.diff.fromVersionId} -> ${result.diff.toVersionId}`);
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
  console.log(`标准化: ${result.standards.ok ? '通过' : '失败'}`);
  console.log(`工作区验证: ${result.validation.valid ? '通过' : '失败'}`);
  if (result.agentIntegration.drift) {
    console.log(`生成物漂移: ${result.agentIntegration.drift.ok ? '无' : '存在'}`);
  }
  console.log('Agent 集成检查:');
  for (const check of result.agentIntegration.checks) {
    console.log(`- ${check.ok ? 'ok' : 'missing'}: ${check.path}`);
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
  console.log(`结果: planned ${result.summary.planned}, updated ${result.summary.updated}, setup ${result.summary.setup}, doctored ${result.summary.doctored}, failed ${result.summary.failed}, skipped ${result.summary.skipped}`);

  const visibleProjects = result.projects
    .filter((project) => project.category !== 'plain-project' || project.status === 'failed')
    .slice(0, 50);
  if (visibleProjects.length > 0) {
    console.log('项目明细:');
    for (const project of visibleProjects) {
      console.log(`- ${project.status}: ${project.relativePath} (${project.category}) -> ${project.plannedAction}`);
      for (const error of project.errors.slice(0, 3)) {
        console.log(`  error: ${error}`);
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

function printRunResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'run-record-hook') {
    console.log(`OpenPrd run hook recorded: ${result.event.eventName} -> ${result.event.outcome}`);
    console.log(`Iterations: ${result.files.iterations}`);
    return;
  }

  if (result.action === 'run-verify') {
    console.log(`OpenPrd run verify: ${result.ok ? '通过' : '失败'}`);
    for (const check of result.checks) {
      console.log(`- ${check.ok ? 'ok' : 'failed'}: ${check.name}`);
    }
    if (result.errors.length > 0) {
      console.log('错误:');
      for (const error of result.errors) {
        console.log(`- ${error}`);
      }
    }
    return;
  }

  console.log('OpenPrd run context');
  console.log(`项目: ${result.projectRoot}`);
  console.log(`验证: ${result.validation.valid ? '通过' : '失败'}`);
  if (result.activeChange) {
    console.log(`激活变更: ${result.activeChange}`);
  }
  if (result.taskSummary) {
    console.log(`任务: ${result.taskSummary.completed}/${result.taskSummary.total} 完成，${result.taskSummary.pending} 待处理，${result.taskSummary.blocked} 阻塞`);
  }
  if (result.discovery) {
    console.log(`Discovery: ${result.discovery.runId} 已覆盖 ${result.discovery.summary.covered}/${result.discovery.summary.total}，待处理 ${result.discovery.summary.pending}`);
  }
  console.log(`下一步类型: ${result.recommendation.type}`);
  console.log(`下一步: ${result.recommendation.title}`);
  console.log(`原因: ${result.recommendation.reason}`);
  console.log(`建议命令: ${result.recommendation.command}`);
  console.log(`验证命令: ${result.recommendation.verifyCommand}`);
  console.log(`状态文件: ${result.files.runState}`);
}

function printLoopResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'loop-prompt') {
    console.log(`OpenPrd loop prompt: ${result.ok ? 'ready' : 'blocked'}`);
    if (result.task) {
      console.log(`任务: ${result.task.id} ${result.task.title}`);
    }
    if (result.promptPath) {
      console.log(`Prompt: ${result.promptPath}`);
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
    console.log(`OpenPrd loop run: ${result.ok ? '通过' : '失败'}${result.dryRun ? ' (dry-run)' : ''}`);
    if (result.task) console.log(`任务: ${result.task.id} ${result.task.title}`);
    if (result.promptPath) console.log(`Prompt: ${result.promptPath}`);
    if (result.invocation?.display) console.log(`执行: ${result.invocation.display}`);
    if (result.finish?.commit) {
      console.log(`Commit: ${result.finish.commit.skipped ? '跳过' : result.finish.commit.sha}`);
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
    if (result.commit) console.log(`Commit: ${result.commit.skipped ? '跳过' : result.commit.sha}`);
    if (result.testReport) console.log(`测试报告: ${result.testReport}`);
    if (result.next) console.log(`下一任务: ${result.next.id} ${result.next.title}`);
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  console.log(`OpenPrd loop: ${result.action} ${result.ok ? '通过' : '失败'}`);
  if (result.changeId) console.log(`Change: ${result.changeId}`);
  if (result.summary) {
    console.log(`任务: ${result.summary.done}/${result.summary.total} 完成，${result.summary.pending} 待处理，${result.summary.failed} 失败，${result.summary.blocked} 阻塞`);
  }
  if (result.next) {
    console.log(`下一任务: ${result.next.id} ${result.next.title}`);
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


export {
  printValidation,
  printStatus,
  printClassifyResult,
  printClarifyResult,
  printCaptureResult,
  printInterviewResult,
  printSynthesizeResult,
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
  printFreezeResult,
  printDiagramResult,
  printHandoffResult,
  printOpenSpecDiscoveryResult,
  printOpenSpecChangeValidationResult,
  printOpenSpecGenerateResult,
  printOpenSpecTaskResult,
  printOpenPrdChangesResult,
  printOpenPrdChangeActionResult,
  printAcceptedSpecsResult
};
