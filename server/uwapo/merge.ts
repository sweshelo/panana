// Ported from lanai-custom-stages web/merge.ts (99304a5); the uwapo there is kept in parallel.
// Several Panana ZIPs published together ("統合して配信"): their stages renumbered so they do not collide
// (renumber.ts), then cut out like one ZIP's (stage-files.ts). The 3DS adds the master rows of all stages in delivery
// order (package order, then content), which is the order the numbers are planned in.
import { parsePananaZip, type MasterBaseline, type PackageSummary } from './panana-zip';
import { isIdentity, planMerge, type MergeProblem, type Renumber } from './renumber';
import { extractStages, type ExtractedStage, type ExtractOptions } from './stage-files';

export interface MergeInput {
  name: string;
  bytes: Uint8Array;
}

export class MergeError extends Error {
  constructor(
    message: string,
    readonly problems: MergeProblem[] = [],
  ) {
    super(message);
  }
}

export interface MergedPackage {
  input: MergeInput;
  summary: PackageSummary;
  plan: Renumber;
  stages: ExtractedStage[];
}

/** The stageKey's first 8 bytes name its save file on the SD (3ds/runtime/stage-state.inc). */
const savePrefix = (key: string) => key.replaceAll('-', '').slice(0, 16).toLowerCase();

/**
 * Cuts the stages of the ZIPs out with new numbers (the ZIPs in the given order; the first keeps its numbers). Throws
 * MergeError with the collisions that renumbering cannot resolve, or with the error of one ZIP.
 */
export async function extractMerged(
  inputs: MergeInput[],
  baseline: MasterBaseline | null,
  options: Omit<ExtractOptions, 'renumber'> = {},
): Promise<{ packages: MergedPackage[]; warnings: string[] }> {
  if (!baseline)
    throw new MergeError('master の基準 (data/master-baseline.json) がないので、ステージの master 行を決められません');
  const summaries: PackageSummary[] = [];
  for (const input of inputs) {
    try {
      summaries.push(await parsePananaZip(input.bytes, baseline));
    } catch (error) {
      throw new MergeError(`${input.name}: ${(error as Error).message}`);
    }
  }
  const { plans, problems } = planMerge(summaries);
  if (problems.length)
    throw new MergeError(`番号を振り直しても統合できません: ${problems.map((p) => p.message).join(' / ')}`, problems);
  const packages: MergedPackage[] = [];
  const warnings: string[] = [];
  for (const [i, input] of inputs.entries()) {
    let extracted;
    try {
      extracted = await extractStages(input.bytes, baseline, { ...options, renumber: plans[i] });
    } catch (error) {
      throw new MergeError(`${input.name}: ${(error as Error).message}`);
    }
    warnings.push(...extracted.warnings.map((w) => `${input.name}: ${w}`));
    if (!isIdentity(plans[i]!))
      for (const s of extracted.stages) {
        const moved = [
          s.original.content !== s.stage.content && `コンテンツ ${s.original.content} → ${s.stage.content}`,
          s.original.archive !== s.stage.archive && `アーカイブ ${s.original.archive} → ${s.stage.archive}`,
        ].filter(Boolean);
        if (moved.length) warnings.push(`${input.name}: 番号を振り直しました (${moved.join('、')})`);
      }
    packages.push({ input, summary: extracted.summary, plan: plans[i]!, stages: extracted.stages });
  }
  // script state is private per stageKey: two stages with one key (or one save file) would share it
  const keys = new Map<string, number>();
  for (const [i, p] of packages.entries())
    for (const s of p.stages) {
      if (!s.events) continue;
      const prefix = savePrefix(s.events.stageKey);
      const other = keys.get(prefix);
      if (other !== undefined) {
        const problem: MergeProblem = {
          kind: 'stageKey',
          value: s.events.stageKey.toLowerCase(),
          packages: [...new Set([other, i])],
          message: `stageKey ${s.events.stageKey} (保存ファイル v${prefix}) を複数のステージが使っています。同じステージの別の版なら片方だけを選び、別のステージなら Panana で stageKey を作り直してください`,
        };
        throw new MergeError(problem.message, [problem]);
      }
      keys.set(prefix, i);
    }
  return { packages, warnings };
}
