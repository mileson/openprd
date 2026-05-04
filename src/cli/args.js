function parseCommandArgs(argv) {
  const args = [...argv];
  const flags = { json: false, force: false, open: false, append: false, init: false, check: false, resume: false, advance: false, verify: false, next: false, generate: false, validate: false, apply: false, archive: false, activate: false, close: false, keep: false, dryRun: false, updateOpenprd: false, setupMissing: false, doctor: false, context: false, recordHook: false, plan: false, prompt: false, loopRun: false, finish: false, commit: false, mark: null, type: 'architecture', mode: 'auto', input: null, field: null, value: null, jsonFile: null, source: null, reference: null, maxIterations: null, maxDepth: null, include: null, exclude: null, report: null, item: null, id: null, status: null, claim: null, notes: null, confidence: null, change: null, tools: 'all', templatePack: null, target: 'openprd', path: null, productType: null, title: null, owner: null, problem: null, whyNow: null, evidence: null, from: null, to: null, event: null, risk: null, outcome: null, preview: null, learn: null, agent: 'codex', agentCommand: null, message: null };
  const positionals = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--open') {
      flags.open = true;
      continue;
    }
    if (arg === '--append') {
      flags.append = true;
      continue;
    }
    if (arg === '--init') {
      flags.init = true;
      continue;
    }
    if (arg === '--check') {
      flags.check = true;
      continue;
    }
    if (arg === '--resume') {
      flags.resume = true;
      continue;
    }
    if (arg === '--advance') {
      flags.advance = true;
      continue;
    }
    if (arg === '--verify') {
      flags.verify = true;
      continue;
    }
    if (arg === '--generate') {
      flags.generate = true;
      continue;
    }
    if (arg === '--validate') {
      flags.validate = true;
      continue;
    }
    if (arg === '--apply') {
      flags.apply = true;
      continue;
    }
    if (arg === '--archive') {
      flags.archive = true;
      continue;
    }
    if (arg === '--activate') {
      flags.activate = true;
      continue;
    }
    if (arg === '--close') {
      flags.close = true;
      continue;
    }
    if (arg === '--keep') {
      flags.keep = true;
      continue;
    }
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--plan') {
      flags.plan = true;
      continue;
    }
    if (arg === '--prompt') {
      flags.prompt = true;
      continue;
    }
    if (arg === '--run') {
      flags.loopRun = true;
      continue;
    }
    if (arg === '--finish') {
      flags.finish = true;
      continue;
    }
    if (arg === '--commit') {
      flags.commit = true;
      continue;
    }
    if (arg === '--update-openprd') {
      flags.updateOpenprd = true;
      continue;
    }
    if (arg === '--setup-missing') {
      flags.setupMissing = true;
      continue;
    }
    if (arg === '--doctor') {
      flags.doctor = true;
      continue;
    }
    if (arg === '--context') {
      flags.context = true;
      continue;
    }
    if (arg === '--record-hook') {
      flags.recordHook = true;
      continue;
    }
    if (arg === '--next') {
      flags.next = true;
      continue;
    }
    if (arg === '--mark') {
      flags.mark = args.shift() ?? null;
      continue;
    }
    if (arg === '--template-pack' || arg === '-t') {
      flags.templatePack = args.shift() ?? null;
      continue;
    }
    if (arg === '--tools') {
      flags.tools = args.shift() ?? 'all';
      continue;
    }
    if (arg === '--agent') {
      flags.agent = args.shift() ?? 'codex';
      continue;
    }
    if (arg === '--agent-command') {
      flags.agentCommand = args.shift() ?? null;
      continue;
    }
    if (arg === '--product-type' || arg === '-P') {
      flags.productType = args.shift() ?? null;
      continue;
    }
    if (arg === '--type') {
      flags.type = args.shift() ?? 'architecture';
      continue;
    }
    if (arg === '--mode') {
      flags.mode = args.shift() ?? 'auto';
      continue;
    }
    if (arg === '--input') {
      flags.input = args.shift() ?? null;
      continue;
    }
    if (arg === '--field') {
      flags.field = args.shift() ?? null;
      continue;
    }
    if (arg === '--value') {
      flags.value = args.shift() ?? null;
      continue;
    }
    if (arg === '--json-file') {
      flags.jsonFile = args.shift() ?? null;
      continue;
    }
    if (arg === '--source') {
      flags.source = args.shift() ?? null;
      continue;
    }
    if (arg === '--reference') {
      flags.reference = args.shift() ?? null;
      continue;
    }
    if (arg === '--max-iterations') {
      flags.maxIterations = args.shift() ?? null;
      continue;
    }
    if (arg === '--max-depth') {
      flags.maxDepth = args.shift() ?? null;
      continue;
    }
    if (arg === '--include') {
      flags.include = args.shift() ?? null;
      continue;
    }
    if (arg === '--exclude') {
      flags.exclude = args.shift() ?? null;
      continue;
    }
    if (arg === '--report') {
      flags.report = args.shift() ?? null;
      continue;
    }
    if (arg === '--item') {
      flags.item = args.shift() ?? null;
      continue;
    }
    if (arg === '--id') {
      flags.id = args.shift() ?? null;
      continue;
    }
    if (arg === '--status') {
      flags.status = args.shift() ?? null;
      continue;
    }
    if (arg === '--claim') {
      flags.claim = args.shift() ?? null;
      continue;
    }
    if (arg === '--notes') {
      flags.notes = args.shift() ?? null;
      continue;
    }
    if (arg === '--confidence') {
      flags.confidence = args.shift() ?? null;
      continue;
    }
    if (arg === '--change') {
      flags.change = args.shift() ?? null;
      continue;
    }
    if (arg === '--title') {
      flags.title = args.shift() ?? null;
      continue;
    }
    if (arg === '--owner') {
      flags.owner = args.shift() ?? null;
      continue;
    }
    if (arg === '--problem') {
      flags.problem = args.shift() ?? null;
      continue;
    }
    if (arg === '--why-now') {
      flags.whyNow = args.shift() ?? null;
      continue;
    }
    if (arg === '--evidence') {
      flags.evidence = args.shift() ?? null;
      continue;
    }
    if (arg === '--event') {
      flags.event = args.shift() ?? null;
      continue;
    }
    if (arg === '--risk') {
      flags.risk = args.shift() ?? null;
      continue;
    }
    if (arg === '--outcome') {
      flags.outcome = args.shift() ?? null;
      continue;
    }
    if (arg === '--preview') {
      flags.preview = args.shift() ?? null;
      continue;
    }
    if (arg === '--message') {
      flags.message = args.shift() ?? null;
      continue;
    }
    if (arg === '--learn') {
      flags.learn = args.shift() ?? null;
      continue;
    }
    if (arg === '--from') {
      flags.from = args.shift() ?? null;
      continue;
    }
    if (arg === '--to') {
      flags.to = args.shift() ?? null;
      continue;
    }
    if (arg === '--target') {
      flags.target = args.shift() ?? 'openprd';
      continue;
    }
    if (arg === '--path' || arg === '-p') {
      flags.path = args.shift() ?? null;
      continue;
    }
    if (arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    positionals.push(arg);
  }

  return { flags, positionals };
}

function usage() {
  return [
    'OpenPrd CLI',
    '',
    'Usage:',
    '  openprd init [path] [--template-pack <base|consumer|b2b|agent>] [--tools <all|codex,claude,cursor>] [--force]',
    '  openprd setup [path] [--tools <all|codex,claude,cursor>] [--force] [--json]',
    '  openprd update [path] [--tools <all|codex,claude,cursor>] [--force] [--json]',
    '  openprd doctor [path] [--tools <all|codex,claude,cursor>] [--json]',
    '  openprd fleet <root> [--dry-run|--doctor|--update-openprd|--setup-missing] [--max-depth <n>] [--include <csv>] [--exclude <csv>] [--report <file>] [--json]',
    '  openprd run [path] [--context|--verify|--record-hook --event <name> --risk <level> --outcome <text> --preview <text>] [--json]',
    '  openprd loop [path] [--init|--plan|--next|--prompt|--run|--verify|--finish] [--change <id>] [--item <task-id>] [--agent <codex|claude>] [--agent-command <cmd>] [--commit] [--dry-run] [--message <text>] [--json]',
    '  openprd classify [path] <consumer|b2b|agent>',
    '  openprd clarify [path] [--json]',
    '  openprd capture [path] (--field <section.path> --value <text|json> | --json-file <answers.json>) [--source <user-confirmed|project-derived|agent-inferred>] [--append] [--json]',
    '  openprd interview [path] [--product-type <consumer|b2b|agent>]',
    '  openprd synthesize [path] [--title <text>] [--owner <text>] [--problem <text>] [--why-now <text>]',
    '  openprd diagram [path] [--type <architecture|product-flow>] [--input <contract.json>] [--mark <pending-confirmation|confirmed|needs-revision>] [--open] [--json]',
    '  openprd diff [path] [--from <version>] [--to <version>]',
    '  openprd history [path]',
    '  openprd validate [path] [--json]',
    '  openprd status [path] [--json]',
    '  openprd freeze [path] [--json]',
    '  openprd handoff [path] [--target openprd] [--json]',
    '  openprd standards [path] [--init] [--check|--verify] [--force] [--json]',
    '  openprd change [path] (--generate|--validate|--apply|--archive|--activate|--close) [--change <id>] [--force] [--keep] [--json]',
    '  openprd changes [path] [--json]',
    '  openprd specs [path] [--json]',
    '  openprd tasks [path] [--next] [--advance] [--verify] [--item <task-id>] [--change <id>] [--evidence <path>] [--notes <text>] [--json]',
    '  openprd discovery [path] [--mode <auto|brownfield|reference|requirement>] [--reference <path>] [--max-iterations <n>] [--resume] [--advance] [--verify] [--item <id>] [--status <covered|blocked|pending>] [--claim <text>] [--evidence <path>] [--notes <text>] [--confidence <0..1>] [--json]',
    '',
  ].join('\n');
}


export { parseCommandArgs, usage };
